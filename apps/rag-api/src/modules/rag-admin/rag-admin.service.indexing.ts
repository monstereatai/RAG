import type { RagAdminServiceContext } from './rag-admin.service.context';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { IndexRepairQueueService } from './index-repair-queue.service';

export class RagAdminIndexingWorkflow {
  constructor(private readonly context: RagAdminServiceContext) {}

  async reindexDocumentSearch(limit = 1000) {
    const documents = await this.context.docMetaRepo.find({
      take: Math.min(Math.max(limit, 1), 5000),
    });
    const chunks = await this.context.chunkRepo.find({
      order: { chunkIndex: 'ASC' },
    });
    const chunksByDoc = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of chunks) {
      const items = chunksByDoc.get(chunk.docId) ?? [];
      items.push(chunk);
      chunksByDoc.set(chunk.docId, items);
    }
    const results = await Promise.allSettled(
      documents.map((doc) => {
        const content = (chunksByDoc.get(doc.docId) ?? [])
          .map((chunk) => chunk.content)
          .join('\n\n');
        let roleScope: string[] = [];
        try {
          roleScope = doc.roleScope
            ? (JSON.parse(doc.roleScope) as string[])
            : [];
        } catch {
          roleScope = [];
        }
        return this.context.elasticsearchProvider.indexDocument({
          docId: doc.docId,
          filename: doc.filename,
          content,
          userId: doc.userId,
          title: doc.title,
          summary: doc.summary,
          sourceAuthority: doc.sourceAuthority,
          projectId: doc.projectId,
          activityId: doc.activityId,
          region: doc.region,
          locale: doc.locale,
          channel: doc.channel,
          roleScope,
          documentType: doc.documentType,
          lifecycleStatus: doc.lifecycleStatus,
          docVersion: doc.docVersion,
          effectiveAt: doc.effectiveAt,
          expiredAt: doc.expiredAt,
        });
      }),
    );
    return {
      indexed: results.filter((result) => result.status === 'fulfilled').length,
      skipped:
        documents.length -
        results.filter((result) => result.status === 'fulfilled').length,
      total: documents.length,
    };
  }

  async repairDocumentIndexes(input: { docIds?: string[]; limit?: number }) {
    const audit = await this.context.auditDocumentIndexes(input.limit ?? 200);
    const requested = input.docIds?.length ? new Set(input.docIds) : null;
    const targets = audit.issues.filter(
      (issue) => !requested || requested.has(issue.docId),
    );
    if (
      this.context.indexRepairQueue?.isEnabled() ||
      this.context.indexRepairQueue?.isRequired()
    ) {
      const jobs = [];
      for (const issue of targets) {
        const job = {
          id: IndexRepairQueueService.jobId(
            issue.docId,
            JSON.stringify({ reasons: issue.reasons, checks: issue.checks }),
          ),
          docId: issue.docId,
          requestedBy: 'rag-admin',
          reason: issue.reasons.join(','),
        };
        const queued = await this.context.indexRepairQueue.enqueue(job);
        jobs.push({ ...job, queued });
      }
      return {
        available: true,
        queued: true,
        requested: targets.length,
        jobs,
        queue: await this.context.indexRepairQueue.getStatus(),
      };
    }
    const results = await Promise.all(
      targets.map((issue) =>
        this.isDescriptionOnlyRepairReason(issue.reasons.join(','))
          ? this.repairRetrievalDescriptions(issue.docId)
          : this.reindexDocument(issue.docId),
      ),
    );
    return { available: true, requested: targets.length, results };
  }

  getIndexRepairQueueStatus() {
    return (
      this.context.indexRepairQueue?.getStatus() ??
      Promise.resolve({
        enabled: false,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      })
    );
  }

  getFailedIndexRepairs(limit = 50) {
    return (
      this.context.indexRepairQueue?.listFailed(limit) ?? Promise.resolve([])
    );
  }

  retryIndexRepair(jobId: string) {
    return (
      this.context.indexRepairQueue?.retryFailed(jobId) ??
      Promise.resolve({ retried: false, reason: 'queue is disabled' })
    );
  }

  async listSecurityAudit(limit = 100) {
    const events = await this.context.domainEvents.listOutbox(
      Math.min(Math.max(limit, 1), 500),
      'security.query_blocked',
    );
    return {
      available: true,
      events,
    };
  }

  retryFailedDocumentTask(taskId: string) {
    return this.context.documentService.retryFailedTask(taskId);
  }

  cancelQueuedDocumentTask(taskId: string) {
    return this.context.documentService.cancelQueuedTask(taskId);
  }

  public isDescriptionOnlyRepairReason(reason?: string): boolean {
    const reasons = reason
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return Boolean(
      reasons?.length &&
      reasons.every((item) => item.startsWith('retrieval_description_')),
    );
  }

  public async repairRetrievalDescriptions(docId: string) {
    const document = await this.context.docMetaRepo.findOne({
      where: { docId },
    });
    if (!document) return null;
    try {
      const retrievalDescriptions =
        await this.rebuildAndAuditRetrievalDescriptions(document);
      return {
        docId,
        reindexed: true,
        descriptionOnly: true,
        retrievalDescriptions,
      };
    } catch (err) {
      const reason = (err as Error).message;
      this.context.logger.error(
        `Retrieval description repair failed for docId=${docId}: ${reason}`,
      );
      return { docId, reindexed: false, reason };
    }
  }

  async reindexDocument(docId: string) {
    const doc = await this.context.docMetaRepo.findOne({ where: { docId } });
    if (!doc) return null;
    const imageIndexEnabled =
      this.context.imageIndexService?.isEnabled() ?? false;

    const chunks = await this.context.chunkRepo.find({
      where: { docId },
      order: { chunkIndex: 'ASC' },
    });

    if (chunks.length === 0) {
      try {
        const restored =
          await this.context.documentService.restoreDocumentFromOriginal(docId);
        if (
          restored &&
          imageIndexEnabled &&
          restored.imageIndex?.indexed === false
        ) {
          return {
            docId,
            reindexed: false,
            reason: `Image index rebuild failed: ${restored.imageIndex.reason ?? 'unknown error'}`,
          };
        }
        return restored
          ? { ...restored, reindexed: true, restoredFromOriginal: true }
          : { docId, reindexed: false, reason: 'document not found' };
      } catch (err) {
        const reason = (err as Error).message;
        this.context.logger.error(
          `Document restore failed for docId=${docId}: ${reason}`,
        );
        return { docId, reindexed: false, reason };
      }
    }

    const userId = doc.userId ?? 'system';
    const content = chunks.map((chunk) => chunk.content).join('\n\n');

    try {
      const vectors = await this.context.embeddingProvider.embedDocuments(
        chunks.map((chunk) => chunk.content),
      );
      if (vectors.length !== chunks.length) {
        throw new Error(
          `embedding count mismatch: expected ${chunks.length}, received ${vectors.length}`,
        );
      }

      const parseArray = (value: string | null | undefined): string[] => {
        if (!value) return [];
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : [];
        } catch {
          return [];
        }
      };
      const indexedChunks = chunks.map((chunk) => ({
        ...chunk,
        userId: chunk.userId ?? userId,
        tenantId: chunk.tenantId ?? doc.tenantId ?? 'legacy',
        headingPath: parseArray(chunk.headingPath),
        roleScope: parseArray(chunk.roleScope),
        hypotheticalQuestions: parseArray(chunk.hypotheticalQuestions),
      }));
      this.context.ragService.removeDocChunks(docId, userId);
      this.context.ragService.indexChunks(indexedChunks, userId);

      if (this.context.elasticsearchProvider.isEnabled()) {
        await this.context.elasticsearchProvider.deleteByDocId(docId, userId);
        await this.context.elasticsearchProvider.indexChunks(
          indexedChunks,
          userId,
          vectors,
        );
        await this.context.elasticsearchProvider.indexDocument({
          docId,
          filename: doc.filename,
          content,
          userId,
          tenantId: doc.tenantId ?? 'legacy',
          title: doc.title ?? doc.filename,
          summary: doc.summary,
          sourceAuthority: doc.sourceAuthority,
          projectId: doc.projectId,
          activityId: doc.activityId,
          region: doc.region,
          locale: doc.locale,
          channel: doc.channel,
          roleScope: parseArray(doc.roleScope),
          documentType: doc.documentType,
          lifecycleStatus: doc.lifecycleStatus,
          docVersion: doc.docVersion,
          contentHash: doc.contentHash,
          indexGeneration: doc.indexGeneration,
          effectiveAt: doc.effectiveAt,
          expiredAt: doc.expiredAt,
        });
        const es =
          await this.context.elasticsearchProvider.getIndexCountsByDocId(
            docId,
            userId,
          );
        const expectedHashes = [
          ...new Set(
            chunks
              .map((chunk) => chunk.contentHash)
              .filter((value): value is string => Boolean(value)),
          ),
        ];
        const expectedGenerations = [
          ...new Set(
            chunks
              .map((chunk) => chunk.indexGeneration)
              .filter((value): value is string => Boolean(value)),
          ),
        ];
        const expectedChunkLifecycleStatuses = [
          ...new Set(
            chunks
              .map((chunk) => chunk.lifecycleStatus)
              .filter((value): value is string => Boolean(value)),
          ),
        ];
        const sameValues = (left: string[], right: string[]) =>
          left.length === right.length &&
          left.every((value) => right.includes(value));
        const hasExpectedHashes =
          expectedHashes.length === 0 ||
          (es.contentHashes?.length === expectedHashes.length &&
            expectedHashes.every((hash) => es.contentHashes?.includes(hash)));
        const hasExpectedGenerations =
          expectedGenerations.length === 0 ||
          (es.indexGenerations?.length === expectedGenerations.length &&
            expectedGenerations.every((generation) =>
              es.indexGenerations?.includes(generation),
            ));
        const hasExpectedLifecycleStatuses =
          es.lifecycleStatusAvailable !== true ||
          (sameValues(
            expectedChunkLifecycleStatuses,
            es.chunkLifecycleStatuses ?? [],
          ) &&
            sameValues(
              [doc.lifecycleStatus],
              es.documentLifecycleStatuses ?? [],
            ));
        if (
          !es.available ||
          es.chunkCount !== chunks.length ||
          es.documentCount !== 1 ||
          !hasExpectedHashes ||
          !hasExpectedGenerations ||
          !hasExpectedLifecycleStatuses
        ) {
          throw new Error(
            es.reason ??
              'elasticsearch reindex count, content hash, generation, or lifecycle verification failed',
          );
        }
      }

      if (this.context.graphService.isEnabled()) {
        const graph = await this.context.graphService.importText(
          content,
          userId,
          docId,
        );
        await this.context.docMetaRepo.update(
          { docId },
          {
            graphIndexStatus: 'indexed',
            graphIndexedAt: new Date(),
            graphIndexError: null,
          },
        );
        this.context.logger.log(
          `Graph index repaired: docId=${docId}, nodes=${graph.nodeCount}, relationships=${graph.relationshipCount}`,
        );
      }

      const retrievalDescriptions =
        await this.rebuildAndAuditRetrievalDescriptions(doc);
      const imageIndex = await this.rebuildImageIndexWhenNeeded(
        docId,
        doc.filename,
        userId,
      );
      if (imageIndexEnabled && !imageIndex.indexed) {
        throw new Error(
          `Image index rebuild failed: ${imageIndex.reason ?? 'unknown error'}`,
        );
      }

      return {
        docId,
        reindexed: true,
        chunkCount: chunks.length,
        preserved: { tenantId: doc.tenantId ?? 'legacy', permissions: true },
        retrievalDescriptions,
        imageIndex,
      };
    } catch (err) {
      this.context.logger.error(
        `Reindex failed for docId=${docId}: ${(err as Error).message}`,
      );
      return {
        docId,
        reindexed: false,
        reason: (err as Error).message,
      };
    }
  }

  private async rebuildImageIndexWhenNeeded(
    docId: string,
    filename: string,
    userId: string,
  ) {
    if (!this.context.imageIndexService?.isEnabled()) {
      return {
        indexed: false,
        assetCount: 0,
        reason: 'image embedding disabled',
      };
    }
    const expected =
      await this.context.documentImageIngestionService.getExpectedIndexAssetCount(
        docId,
        filename,
        userId,
      );
    const actual = await this.context.imageIndexService.countByDocId(
      docId,
      userId,
    );
    if (actual === expected) return { indexed: true, assetCount: actual };
    return this.context.documentService.rebuildImageIndexFromOriginal(docId);
  }

  public async rebuildAndAuditRetrievalDescriptions(
    document: Pick<DocumentMetaEntity, 'tenantId' | 'docId'>,
  ) {
    const tenantId = document.tenantId ?? 'legacy';
    const rebuild = await this.context.retrievalDescriptionService.rebuild({
      tenantId,
      docId: document.docId,
    });
    const audit =
      await this.context.retrievalDescriptionService.auditForDocument({
        tenantId,
        docId: document.docId,
      });
    if (
      !audit.documentFound ||
      audit.expectedCount !== audit.pgCount ||
      audit.expectedCount !== audit.milvusCount ||
      audit.missingCount > 0 ||
      audit.staleCount > 0 ||
      audit.contentMismatchCount > 0 ||
      audit.sourceMappingMismatchCount > 0
    ) {
      throw new Error(
        `retrieval description verification failed: ${JSON.stringify(audit)}`,
      );
    }
    return { ...rebuild, audit };
  }
}
