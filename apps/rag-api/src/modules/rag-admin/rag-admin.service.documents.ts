import type { RagAdminServiceContext } from './rag-admin.service.context';
import { BadRequestException } from '@nestjs/common';
import { In } from 'typeorm';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentReviewEntity } from '../../providers/db/entities/document-review.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { randomUUID } from 'node:crypto';
import { RagDocumentQueryDto } from './dto/rag-admin.dto';
import {
  DocumentChangeType,
  DocumentLifecycleStatus,
  GameDocumentType,
} from '../document/document-profile.util';

export class RagAdminDocumentsWorkflow {
  constructor(private readonly context: RagAdminServiceContext) {}

  async listDocuments(query: RagDocumentQueryDto) {
    const allDocs = await this.context.docMetaRepo.find({
      // 上传时间倒序，docId 作为稳定的并列排序，确保同一毫秒上传时结果仍可复现。
      order: { createdAt: 'DESC', docId: 'DESC' },
    });

    let filtered = allDocs;

    if (query.q) {
      const q = query.q.toLowerCase();
      filtered = filtered.filter(
        (doc) =>
          doc.filename.toLowerCase().includes(q) ||
          (doc.title && doc.title.toLowerCase().includes(q)),
      );
    }
    if (query.category) {
      filtered = filtered.filter((doc) => doc.category === query.category);
    }
    if (query.userId) {
      filtered = filtered.filter((doc) => doc.userId === query.userId);
    }
    if (query.sourceAuthority) {
      filtered = filtered.filter(
        (doc) => doc.sourceAuthority === query.sourceAuthority,
      );
    }
    if (query.lifecycleStatus) {
      filtered = filtered.filter(
        (doc) => doc.lifecycleStatus === query.lifecycleStatus,
      );
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // 按权限主体类型过滤（公共/部门文档）
    if (query.scope) {
      const readableDocIds = await this.listReadableDocIdsByScope(
        query.scope,
        query.departmentId,
      );
      // 权限集合为空：直接返回空页，避免无意义的分页查询
      if (readableDocIds.size === 0) {
        return { total: 0, page, pageSize, items: [] };
      }
      filtered = filtered.filter((doc) => readableDocIds.has(doc.docId));
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageDocs = filtered.slice(start, start + pageSize);

    // 当页文档的权限摘要：一次 In() 查询 read 权限行，按 docId 分组（不去重跨类型）
    const permissionRows = pageDocs.length
      ? await this.context.permissionRepo.find({
          where: {
            docId: In(pageDocs.map((doc) => doc.docId)),
            action: 'read',
          },
        })
      : [];
    const permissionsByDoc = new Map<
      string,
      Array<{
        subjectType: DocumentPermissionEntity['subjectType'];
        subjectId: string;
      }>
    >();
    for (const row of permissionRows) {
      const list = permissionsByDoc.get(row.docId) ?? [];
      list.push({ subjectType: row.subjectType, subjectId: row.subjectId });
      permissionsByDoc.set(row.docId, list);
    }

    const items = await Promise.all(
      pageDocs.map(async (doc) => {
        const obsidianPath = doc.userId
          ? await this.context.obsidianKnowledge.findNoteByRagDocId(doc.docId, {
              userId: doc.userId,
            })
          : null;
        return {
          docId: doc.docId,
          filename: doc.filename,
          chunkCount: doc.chunkCount,
          userId: doc.userId ?? 'unknown',
          category: doc.category ?? '其他',
          sourceAuthority: doc.sourceAuthority ?? 'normal',
          docVersion: doc.docVersion ?? 'unknown',
          lifecycleStatus: doc.lifecycleStatus,
          reviewStatus: doc.reviewStatus,
          supersedesDocId: doc.supersedesDocId,
          effectiveAt: doc.effectiveAt?.toISOString() ?? null,
          expiredAt: doc.expiredAt?.toISOString() ?? null,
          title: doc.title ?? null,
          createdAt: doc.createdAt.toISOString(),
          obsidianPath,
          obsidianStatus: obsidianPath ? 'linked' : 'missing',
          permissions: permissionsByDoc.get(doc.docId) ?? [],
          indexPipeline: {
            rag: {
              status: doc.chunkCount > 0 ? 'indexed' : 'pending',
              chunkCount: doc.chunkCount,
              durationMs: null,
              completedAt: null,
              error: doc.chunkCount > 0 ? null : '尚未生成可检索 Chunk',
            },
            es: {
              status:
                doc.chunkCount > 0 &&
                this.context.elasticsearchProvider.isEnabled()
                  ? 'indexed'
                  : this.context.elasticsearchProvider.isEnabled()
                    ? 'pending'
                    : 'skipped',
              chunkCount: doc.chunkCount,
              durationMs: null,
              completedAt: null,
              error: null,
            },
            graph: {
              status: doc.graphIndexStatus,
              chunkCount: null,
              durationMs: null,
              completedAt: doc.graphIndexedAt?.toISOString() ?? null,
              error: doc.graphIndexError,
            },
          },
        };
      }),
    );

    return { total, page, pageSize, items };
  }

  async getDocument(docId: string) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc || !doc.userId) return null;

    const obsidianPath =
      await this.context.obsidianKnowledge.findNoteByRagDocId(docId, {
        userId: doc.userId,
      });
    return {
      docId: doc.docId,
      filename: doc.filename,
      chunkCount: doc.chunkCount,
      userId: doc.userId ?? 'unknown',
      title: doc.title ?? null,
      author: doc.author ?? null,
      summary: doc.summary ?? null,
      keywords: doc.keywords ? (JSON.parse(doc.keywords) as string[]) : [],
      language: doc.language ?? null,
      category: doc.category ?? '其他',
      sourceAuthority: doc.sourceAuthority ?? 'normal',
      obsidianPath,
      obsidianStatus: obsidianPath ? 'linked' : 'missing',
      docVersion: doc.docVersion ?? 'unknown',
      lifecycleStatus: doc.lifecycleStatus,
      reviewStatus: doc.reviewStatus,
      reviewedBy: doc.reviewedBy,
      reviewedAt: doc.reviewedAt?.toISOString() ?? null,
      reviewComment: doc.reviewComment,
      supersedesDocId: doc.supersedesDocId,
      effectiveAt: doc.effectiveAt?.toISOString() ?? null,
      expiredAt: doc.expiredAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
      indexPipeline: {
        rag: {
          status: doc.chunkCount > 0 ? 'indexed' : 'pending',
          chunkCount: doc.chunkCount,
          durationMs: null,
          completedAt: null,
          error: doc.chunkCount > 0 ? null : '尚未生成可检索 Chunk',
        },
        es: {
          status:
            doc.chunkCount > 0 && this.context.elasticsearchProvider.isEnabled()
              ? 'indexed'
              : this.context.elasticsearchProvider.isEnabled()
                ? 'pending'
                : 'skipped',
          chunkCount: doc.chunkCount,
          durationMs: null,
          completedAt: null,
          error: null,
        },
        graph: {
          status: doc.graphIndexStatus,
          chunkCount: null,
          durationMs: null,
          completedAt: doc.graphIndexedAt?.toISOString() ?? null,
          error: doc.graphIndexError,
        },
      },
    };
  }

  public async listReadableDocIdsByScope(
    scope: 'public' | 'department',
    departmentId?: string,
  ): Promise<Set<string>> {
    const rows = await this.context.permissionRepo.find({
      where: {
        subjectType: scope,
        action: 'read',
        // scope=department 时可按 subjectId（部门 id）二次过滤
        ...(scope === 'department' && departmentId
          ? { subjectId: departmentId }
          : {}),
      },
    });
    return new Set(rows.map((row) => row.docId));
  }

  async listDocumentVersions(docId: string) {
    const root = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!root) return null;
    if (!root.userId) return [];
    const all = await this.context.docMetaRepo.find({
      where: { userId: root.userId },
      order: { createdAt: 'ASC' },
    });
    const ids = new Set([docId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const doc of all) {
        if (
          doc.supersedesDocId &&
          ids.has(doc.supersedesDocId) &&
          !ids.has(doc.docId)
        ) {
          ids.add(doc.docId);
          changed = true;
        }
        if (
          ids.has(doc.docId) &&
          doc.supersedesDocId &&
          !ids.has(doc.supersedesDocId)
        ) {
          ids.add(doc.supersedesDocId);
          changed = true;
        }
      }
    }
    return all
      .filter((doc) => ids.has(doc.docId))
      .map((doc) => this.toDocumentVersionItem(doc));
  }

  async createDocumentVersion(
    docId: string,
    body: {
      content?: string;
      filename?: string;
      docVersion?: string;
      effectiveAt?: string;
      expiredAt?: string;
      lifecycleStatus?: DocumentLifecycleStatus;
      documentType?: GameDocumentType;
    },
  ) {
    const previous = await this.context.docMetaRepo.findOne({
      where: { docId },
    });
    if (!previous) return null;
    if (!previous.userId) throw new Error('document owner is missing');
    const content = body.content?.trim();
    if (!content) throw new Error('content is required');
    const roleScope = previous.roleScope
      ? (JSON.parse(previous.roleScope) as string[])
      : [];
    const result = await this.context.obsidianIngest.ingestText({
      title: body.filename?.trim() || previous.filename,
      content,
      userId: previous.userId,
      filename: body.filename?.trim() || previous.filename,
      sourceType: 'document',
      contentType: 'text/markdown',
      originalBuffer: Buffer.from(content, 'utf8'),
      businessMetadata: {
        projectId: previous.projectId,
        activityId: previous.activityId,
        region: previous.region,
        locale: previous.locale,
        channel: previous.channel,
        roleScope,
        documentType:
          body.documentType ?? (previous.documentType as GameDocumentType),
        lifecycleStatus: 'draft',
        supersedesDocId: docId,
        docVersion: body.docVersion ?? null,
        effectiveAt: body.effectiveAt ?? null,
        expiredAt: body.expiredAt ?? null,
      },
    });
    return { ...result.rag, obsidian: result.obsidian, previousDocId: docId };
  }

  async incrementalUpdateDocument(
    docId: string,
    body: {
      content?: string;
      filename?: string;
      docVersion?: string;
      effectiveAt?: string;
      expiredAt?: string;
      lifecycleStatus?: DocumentLifecycleStatus;
      documentType?: GameDocumentType;
      changeType?: DocumentChangeType;
      validityMonths?: number;
    },
  ) {
    const previous = await this.context.docMetaRepo.findOne({
      where: { docId },
    });
    if (previous === null) return null;
    if (previous.userId === null || previous.userId === undefined) {
      throw new BadRequestException('document owner is missing');
    }
    const content = body.content?.trim();
    if (content === undefined || content.length === 0) {
      throw new BadRequestException('content is required');
    }
    let roleScope: string[] = [];
    try {
      roleScope = previous.roleScope
        ? (JSON.parse(previous.roleScope) as string[])
        : [];
    } catch {
      roleScope = [];
    }
    const result = await this.context.obsidianIngest.ingestText({
      title: body.filename?.trim() || previous.filename,
      content,
      userId: previous.userId,
      tenantId: previous.tenantId ?? 'legacy',
      filename: body.filename?.trim() || previous.filename,
      sourceType: 'document',
      contentType: 'text/markdown',
      originalBuffer: Buffer.from(content, 'utf8'),
      docId,
      incrementalUpdate: true,
      businessMetadata: {
        projectId: previous.projectId,
        activityId: previous.activityId,
        region: previous.region,
        locale: previous.locale,
        channel: previous.channel,
        roleScope,
        documentType:
          body.documentType ??
          (previous.documentType as GameDocumentType | undefined),
        lifecycleStatus:
          body.lifecycleStatus ??
          (previous.lifecycleStatus as DocumentLifecycleStatus),
        supersedesDocId: previous.supersedesDocId,
        docVersion: body.docVersion ?? previous.docVersion,
        effectiveAt: body.effectiveAt ?? null,
        expiredAt:
          body.expiredAt ??
          (previous.expiredAt ? previous.expiredAt.toISOString() : null),
        changeType: body.changeType ?? 'amend',
        validityMonths: body.validityMonths,
      },
    });
    return {
      ...result.rag,
      obsidian: result.obsidian,
      incrementalUpdate: true,
    };
  }

  async updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: DocumentLifecycleStatus,
  ) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc || !doc.userId) return null;
    if (lifecycleStatus === 'effective') {
      return this.promoteDocumentVersion(docId);
    }
    const updated = await this.context.documentService.updateLifecycle(
      docId,
      doc.userId,
      lifecycleStatus,
      {
        eventType: 'document.lifecycle_changed',
        aggregateType: 'document',
        aggregateId: docId,
        payload: { lifecycleStatus },
      },
    );
    return updated ? { docId, lifecycleStatus } : null;
  }

  async archiveDocument(docId: string) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    if (
      doc.lifecycleStatus !== 'effective' &&
      doc.lifecycleStatus !== 'confirmed'
    ) {
      throw new BadRequestException(
        `document lifecycle status is ${doc.lifecycleStatus ?? 'unknown'}, only effective/confirmed documents can be archived`,
      );
    }
    const updated = await this.updateDocumentLifecycle(docId, 'archived');
    if (!updated) return null;
    return { docId, archived: true, lifecycleStatus: 'archived' as const };
  }

  async unarchiveDocument(docId: string) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    if (doc.lifecycleStatus !== 'archived') {
      throw new BadRequestException(
        `document lifecycle status is ${doc.lifecycleStatus ?? 'unknown'}, only archived documents can be unarchived`,
      );
    }
    if (doc.reviewStatus !== 'approved') {
      throw new BadRequestException(
        'document must be approved before unarchive',
      );
    }
    const updated = await this.updateDocumentLifecycle(docId, 'effective');
    if (!updated) return null;
    return { docId, unarchived: true, lifecycleStatus: 'effective' as const };
  }

  async promoteDocumentVersion(docId: string) {
    const target = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!target || !target.userId) return null;
    if (target.reviewStatus !== 'approved') {
      throw new BadRequestException(
        'document must be approved before promotion',
      );
    }
    const versions = await this.context.listDocumentVersions(docId);
    if (!versions) return null;
    const updated = await this.context.documentService.activateVersion(
      docId,
      target.userId,
      versions.map((version) => version.docId),
      {
        eventType: 'document.effective',
        aggregateType: 'document',
        aggregateId: docId,
        payload: { docVersion: target.docVersion ?? null },
      },
    );
    return updated ? { docId, lifecycleStatus: 'effective' } : null;
  }

  async rollbackDocumentVersion(docId: string) {
    const activated = await this.context.promoteDocumentVersion(docId);
    if (!activated) return null;
    return {
      activeDocId: docId,
      versions: await this.context.listDocumentVersions(docId),
    };
  }

  async submitDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.updateDocumentReview(
      docId,
      'pending_review',
      'submitted',
      operatorId,
      comment,
    );
  }

  async approveDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.updateDocumentReview(
      docId,
      'approved',
      'approved',
      operatorId,
      comment,
    );
  }

  async rejectDocumentReview(
    docId: string,
    operatorId?: string,
    comment?: string,
  ) {
    return this.updateDocumentReview(
      docId,
      'rejected',
      'rejected',
      operatorId,
      comment,
    );
  }

  async listDocumentReviews(docId: string) {
    return this.context.documentReviewRepo.find({
      where: { docId },
      order: { createdAt: 'DESC' },
    });
  }

  public async updateDocumentReview(
    docId: string,
    reviewStatus: DocumentMetaEntity['reviewStatus'],
    action: DocumentReviewEntity['action'],
    operatorId?: string,
    comment?: string,
  ) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    const now = new Date();
    await this.context.docMetaRepo.manager.transaction(async (manager) => {
      await manager.getRepository(DocumentMetaEntity).update(docId, {
        reviewStatus,
        reviewedBy: operatorId ?? null,
        reviewedAt: action === 'submitted' ? null : now,
        reviewComment: comment?.trim() || null,
      });
      await manager.getRepository(DocumentReviewEntity).save(
        this.context.documentReviewRepo.create({
          id: randomUUID(),
          docId,
          action,
          operatorId: operatorId ?? null,
          comment: comment?.trim() || null,
        }),
      );
      if (action === 'approved' || action === 'rejected') {
        await this.context.domainEvents.emitInTransaction(manager, {
          eventType: `document.review_${action}`,
          aggregateType: 'document',
          aggregateId: docId,
          payload: { reviewStatus, operatorId: operatorId ?? null },
        });
      }
    });
    return { docId, reviewStatus, action };
  }

  public toDocumentVersionItem(doc: DocumentMetaEntity) {
    return {
      docId: doc.docId,
      filename: doc.filename,
      docVersion: doc.docVersion ?? 'unknown',
      lifecycleStatus: doc.lifecycleStatus,
      reviewStatus: doc.reviewStatus,
      supersedesDocId: doc.supersedesDocId,
      effectiveAt: doc.effectiveAt?.toISOString() ?? null,
      expiredAt: doc.expiredAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
      chunkCount: doc.chunkCount,
    };
  }

  async getDocumentChunks(docId: string) {
    const chunks = await this.context.chunkRepo.find({
      where: { docId },
      order: { chunkIndex: 'ASC' },
    });

    return chunks.map((chunk) => ({
      id: chunk.id,
      docId: chunk.docId,
      chunkIndex: chunk.chunkIndex,
      chunkType: chunk.chunkType,
      content: chunk.content.slice(0, 500),
      contentLength: chunk.content.length,
      headingPath: chunk.headingPath
        ? (JSON.parse(chunk.headingPath) as string[])
        : [],
      sectionId: chunk.sectionId,
      clauseId: chunk.clauseId,
      tableRef: chunk.tableRef,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      docVersion: chunk.docVersion,
      effectiveAt: chunk.effectiveAt?.toISOString() ?? null,
      expiredAt: chunk.expiredAt?.toISOString() ?? null,
      sourceAuthority: chunk.sourceAuthority,
    }));
  }

  async updateDocumentPermissions(
    docId: string,
    subjects: Array<{
      type: 'user' | 'role' | 'department' | 'public';
      id: string;
    }>,
  ) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc) {
      return { docId, updated: false, reason: 'document not found' };
    }
    await this.context.documentService.setPermissions(docId, subjects);
    return {
      docId,
      updated: true,
      subjectCount: subjects.length,
    };
  }

  async batchDocumentOperation(body: {
    action?: 'reindex' | 'delete' | 'status';
    docIds?: string[];
    userId?: string;
  }) {
    const action = body.action ?? 'status';
    const docIds = body.docIds ?? [];
    const results: Array<Record<string, unknown> | null> = [];

    for (const docId of docIds) {
      if (action === 'reindex') {
        results.push(await this.context.reindexDocument(docId));
        continue;
      }

      if (action === 'delete') {
        const doc = await this.context.docMetaRepo.findOne({
          where: { docId },
        });
        if (!doc) {
          results.push({ docId, deleted: false, reason: 'document not found' });
          continue;
        }
        await this.context.documentService.delete(
          docId,
          body.userId ?? doc.userId ?? 'system',
        );
        results.push({ docId, deleted: true });
        continue;
      }

      const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
      results.push({
        docId,
        exists: !!doc,
        chunkCount: doc?.chunkCount ?? 0,
      });
    }

    return {
      action,
      processed: results.length,
      results,
    };
  }
}
