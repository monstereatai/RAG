import { Logger } from '@nestjs/common';
import { In, LessThan, Repository } from 'typeorm';
import { GraphService } from '../graph/graph.service';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentImageIngestionService } from '../document/document-image-ingestion.service';
import { ImageIndexService } from '../image-index/image-index.service';
import {
  DocumentRetrievalDescriptionService,
  type DocumentRetrievalDescriptionAudit,
} from '../document/document-retrieval-description.service';
import type { RagAdminCapability } from '../../rag/contracts/rag-capabilities';
import type {
  DocumentIndexAuditResult,
  IndexAuditCheck,
} from './rag-admin.service.types';

export interface RagAdminAuditWorkflowContext {
  logger: Logger;
  docMetaRepo: Repository<DocumentMetaEntity>;
  chunkRepo: Repository<DocumentChunkEntity>;
  graphService: GraphService;
  ragService: RagAdminCapability;
  elasticsearchProvider: ElasticsearchProvider;
  vectorStoreProvider: VectorStoreProvider;
  documentImageIngestionService: DocumentImageIngestionService;
  imageIndexService?: ImageIndexService;
  retrievalDescriptionService: DocumentRetrievalDescriptionService;
}

export class RagAdminAuditWorkflow {
  constructor(private readonly context: RagAdminAuditWorkflowContext) {}

  async auditDocumentIndexes(
    limit = 200,
    cursor?: { createdAt: string; docId: string },
  ): Promise<DocumentIndexAuditResult> {
    const pageSize = Math.min(Math.max(limit, 1), 1000);
    const after = cursor ? new Date(cursor.createdAt) : undefined;
    const docs = await this.context.docMetaRepo.find({
      ...(after && Number.isFinite(after.getTime()) && cursor
        ? {
            where: [
              { createdAt: LessThan(after) },
              { createdAt: after, docId: LessThan(cursor.docId) },
            ],
          }
        : {}),
      order: { createdAt: 'DESC', docId: 'DESC' },
      take: pageSize,
    });
    const chunks = docs.length
      ? await this.context.chunkRepo.find({
          where: { docId: In(docs.map((doc) => doc.docId)) },
          select: [
            'docId',
            'contentHash',
            'indexGeneration',
            'lifecycleStatus',
          ],
        })
      : [];
    const dbChunkCounts = new Map<string, number>();
    const dbChunkHashes = new Map<string, Set<string>>();
    const dbGenerations = new Map<string, Set<string>>();
    const dbChunkLifecycleStatuses = new Map<string, Set<string>>();
    for (const chunk of chunks) {
      dbChunkCounts.set(chunk.docId, (dbChunkCounts.get(chunk.docId) ?? 0) + 1);
      if (chunk.lifecycleStatus) {
        const statuses =
          dbChunkLifecycleStatuses.get(chunk.docId) ?? new Set<string>();
        statuses.add(chunk.lifecycleStatus);
        dbChunkLifecycleStatuses.set(chunk.docId, statuses);
      }
      if (chunk.contentHash) {
        const hashes = dbChunkHashes.get(chunk.docId) ?? new Set<string>();
        hashes.add(chunk.contentHash);
        dbChunkHashes.set(chunk.docId, hashes);
      }
      if (chunk.indexGeneration) {
        const generations = dbGenerations.get(chunk.docId) ?? new Set<string>();
        generations.add(chunk.indexGeneration);
        dbGenerations.set(chunk.docId, generations);
      }
    }
    const now = Date.now();
    const checks = [];
    for (let offset = 0; offset < docs.length; offset += 10) {
      const batchChecks = await Promise.all(
        docs.slice(offset, offset + 10).map(async (doc) => {
          const expected = dbChunkCounts.get(doc.docId) ?? 0;
          const expectedHashes = [
            ...(dbChunkHashes.get(doc.docId) ?? new Set()),
          ];
          const expectedGenerations = [
            ...(dbGenerations.get(doc.docId) ?? new Set()),
          ];
          const expectedChunkLifecycleStatuses = [
            ...(dbChunkLifecycleStatuses.get(doc.docId) ?? new Set()),
          ];
          const sameValues = (left: string[], right: string[]) =>
            left.length === right.length &&
            left.every((value) => right.includes(value));
          const bm25 = this.context.ragService.getIndexedChunkCount(
            doc.docId,
            doc.userId ?? undefined,
          );
          const bm25Persistence =
            this.context.ragService.getSnapshotPersistenceStatus(doc.docId);
          const es =
            await this.context.elasticsearchProvider.getIndexCountsByDocId(
              doc.docId,
              doc.userId ?? undefined,
            );
          const bm25Hashes =
            typeof this.context.ragService.getIndexedChunkHashes === 'function'
              ? this.context.ragService.getIndexedChunkHashes(
                  doc.docId,
                  doc.userId ?? undefined,
                )
              : {
                  hashes: [],
                  generations: [],
                  lifecycleStatuses: [],
                  complete: false,
                };
          const bm25HashMismatch =
            expectedHashes.length > 0 &&
            (bm25Hashes.hashes.length !== expectedHashes.length ||
              !expectedHashes.every((hash) =>
                bm25Hashes.hashes.includes(hash),
              ));
          const bm25GenerationMismatch =
            expectedGenerations.length > 0 &&
            (bm25Hashes.generations.length !== expectedGenerations.length ||
              !expectedGenerations.every((generation) =>
                bm25Hashes.generations.includes(generation),
              ));
          const bm25LifecycleMismatch = !sameValues(
            expectedChunkLifecycleStatuses,
            bm25Hashes.lifecycleStatuses,
          );
          const esHashMismatch =
            expectedHashes.length > 0 &&
            (es.contentHashes?.length !== expectedHashes.length ||
              !expectedHashes.every((hash) =>
                es.contentHashes?.includes(hash),
              ));
          const esGenerationMismatch =
            expectedGenerations.length > 0 &&
            (es.indexGenerations?.length !== expectedGenerations.length ||
              !expectedGenerations.every((generation) =>
                es.indexGenerations?.includes(generation),
              ));
          const esLifecycleMismatch =
            es.lifecycleStatusAvailable === true &&
            (!sameValues(
              expectedChunkLifecycleStatuses,
              es.chunkLifecycleStatuses ?? [],
            ) ||
              !sameValues(
                doc.lifecycleStatus ? [doc.lifecycleStatus] : [],
                es.documentLifecycleStatuses ?? [],
              ));
          const milvus: IndexAuditCheck = {
            status: 'skipped',
            reason: 'main_document_chunks_migrated_to_elasticsearch',
          };
          const graph = await this.readGraphIndexCheck(
            doc.graphIndexStatus,
            doc.docId,
            doc.userId ?? 'system',
          );
          let image: IndexAuditCheck = {
            status: 'skipped',
            reason: 'image_index_disabled',
          };
          if (this.context.imageIndexService?.isEnabled()) {
            const imageUserId = doc.userId ?? 'system';
            try {
              const expectedImageAssets =
                await this.context.documentImageIngestionService.getExpectedIndexAssetCount(
                  doc.docId,
                  doc.filename,
                  imageUserId,
                );
              image = await this.readIndexCheck(
                true,
                () =>
                  this.context.imageIndexService!.countByDocId(
                    doc.docId,
                    imageUserId,
                  ),
                expectedImageAssets,
                'image',
              );
            } catch (err) {
              image = {
                status: 'unavailable',
                reason: `image_index_audit_unavailable:${(err as Error).message}`,
              };
            }
          }
          let descriptionAudit: DocumentRetrievalDescriptionAudit | null = null;
          try {
            descriptionAudit =
              await this.context.retrievalDescriptionService.auditForDocument({
                tenantId: doc.tenantId ?? 'legacy',
                docId: doc.docId,
              });
          } catch (err) {
            this.context.logger.warn(
              `Retrieval description audit failed for docId=${doc.docId}: ${(err as Error).message}`,
            );
          }
          const descriptionReasons: string[] = [];
          if (!descriptionAudit) {
            descriptionReasons.push('retrieval_description_audit_unavailable');
          } else {
            if (!descriptionAudit.documentFound) {
              descriptionReasons.push('retrieval_description_document_missing');
            }
            if (descriptionAudit.missingPgCount > 0) {
              descriptionReasons.push('retrieval_description_missing_pg');
            }
            if (descriptionAudit.stalePgCount > 0) {
              descriptionReasons.push('retrieval_description_stale_pg');
            }
            if (descriptionAudit.missingMilvusCount > 0) {
              descriptionReasons.push('retrieval_description_missing_milvus');
            }
            if (descriptionAudit.staleMilvusCount > 0) {
              descriptionReasons.push('retrieval_description_stale_milvus');
            }
            if (descriptionAudit.contentMismatchCount > 0) {
              descriptionReasons.push('retrieval_description_content_mismatch');
            }
            if (descriptionAudit.sourceMappingMismatchCount > 0) {
              descriptionReasons.push(
                'retrieval_description_source_mapping_mismatch',
              );
            }
            if (
              descriptionAudit.missingCount > 0 &&
              descriptionAudit.missingPgCount === 0 &&
              descriptionAudit.missingMilvusCount === 0
            ) {
              descriptionReasons.push('retrieval_description_missing');
            }
            if (
              descriptionAudit.staleCount > 0 &&
              descriptionAudit.stalePgCount === 0 &&
              descriptionAudit.staleMilvusCount === 0
            ) {
              descriptionReasons.push('retrieval_description_stale');
            }
            if (
              descriptionAudit.expectedCount !== descriptionAudit.pgCount ||
              descriptionAudit.expectedCount !== descriptionAudit.milvusCount
            ) {
              descriptionReasons.push('retrieval_description_count_mismatch');
            }
          }
          const descriptionsMismatch = descriptionReasons.length > 0;
          const retrievalDescriptions: IndexAuditCheck = descriptionAudit
            ? {
                status: descriptionsMismatch ? 'mismatch' : 'ok',
                expected: descriptionAudit.expectedCount,
                actual: descriptionAudit.pgCount,
                docVersion: descriptionAudit.docVersion,
                indexGeneration: descriptionAudit.indexGeneration,
                lifecycleStatus: descriptionAudit.lifecycleStatus,
                reviewStatus: descriptionAudit.reviewStatus,
                effectiveAt: descriptionAudit.effectiveAt,
                expiredAt: descriptionAudit.expiredAt,
                pgCount: descriptionAudit.pgCount,
                milvusCount: descriptionAudit.milvusCount,
                missingCount: descriptionAudit.missingCount,
                staleCount: descriptionAudit.staleCount,
                missingPgCount: descriptionAudit.missingPgCount,
                stalePgCount: descriptionAudit.stalePgCount,
                missingMilvusCount: descriptionAudit.missingMilvusCount,
                staleMilvusCount: descriptionAudit.staleMilvusCount,
                contentMismatchCount: descriptionAudit.contentMismatchCount,
                sourceMappingMismatchCount:
                  descriptionAudit.sourceMappingMismatchCount,
                ...(descriptionsMismatch
                  ? { reason: descriptionReasons[0] }
                  : {}),
              }
            : {
                status: 'unavailable',
                reason: 'retrieval_description_audit_unavailable',
              };
          const indexChecks: Record<string, IndexAuditCheck> = {
            postgres: {
              status: doc.chunkCount === expected ? 'ok' : 'mismatch',
              expected,
              actual: doc.chunkCount,
              ...(doc.chunkCount === expected
                ? {}
                : { reason: 'documents_meta_chunk_count_mismatch' }),
              expectedContentHash: doc.contentHash ?? undefined,
              expectedIndexGeneration: doc.indexGeneration ?? undefined,
            },
            bm25: {
              status:
                bm25 === expected &&
                !bm25HashMismatch &&
                !bm25GenerationMismatch &&
                !bm25LifecycleMismatch &&
                bm25Persistence.persisted
                  ? 'ok'
                  : 'mismatch',
              expected,
              actual: bm25,
              expectedContentHash: expectedHashes.join(','),
              actualContentHashes: bm25Hashes.hashes,
              expectedIndexGeneration: expectedGenerations.join(','),
              actualIndexGenerations: bm25Hashes.generations,
              expectedChunkLifecycleStatuses,
              actualChunkLifecycleStatuses: bm25Hashes.lifecycleStatuses,
              persistenceReason: bm25Persistence.reason,
              ...(bm25 === expected &&
              !bm25HashMismatch &&
              !bm25GenerationMismatch &&
              !bm25LifecycleMismatch &&
              bm25Persistence.persisted
                ? {}
                : {
                    reason: !bm25Persistence.persisted
                      ? 'bm25_snapshot_not_persisted'
                      : bm25 !== expected
                        ? 'bm25_chunk_count_mismatch'
                        : bm25HashMismatch
                          ? 'bm25_content_hash_mismatch'
                          : bm25GenerationMismatch
                            ? 'bm25_generation_mismatch'
                            : 'bm25_lifecycle_mismatch',
                  }),
            },
            elasticsearch: es.available
              ? (() => {
                  const countsMatch =
                    es.chunkCount === expected &&
                    (expected === 0 || es.documentCount === 1);
                  const indexesMatch =
                    countsMatch &&
                    !esHashMismatch &&
                    !esGenerationMismatch &&
                    !esLifecycleMismatch;
                  return {
                    status: !indexesMatch
                      ? 'mismatch'
                      : es.lifecycleStatusAvailable === true
                        ? 'ok'
                        : 'unverified',
                    expected,
                    actual: es.chunkCount,
                    documentCount: es.documentCount,
                    expectedContentHash: expectedHashes.join(','),
                    actualContentHashes: es.contentHashes,
                    expectedIndexGeneration: expectedGenerations.join(','),
                    actualIndexGenerations: es.indexGenerations,
                    expectedChunkLifecycleStatuses,
                    actualChunkLifecycleStatuses: es.chunkLifecycleStatuses,
                    expectedDocumentLifecycleStatus: doc.lifecycleStatus,
                    actualDocumentLifecycleStatuses:
                      es.documentLifecycleStatuses,
                    ...(!indexesMatch
                      ? {
                          reason: !countsMatch
                            ? 'elasticsearch_index_count_mismatch'
                            : esHashMismatch
                              ? 'elasticsearch_content_hash_mismatch'
                              : esGenerationMismatch
                                ? 'elasticsearch_generation_mismatch'
                                : 'elasticsearch_lifecycle_mismatch',
                        }
                      : es.lifecycleStatusAvailable !== true
                        ? {
                            reason:
                              es.lifecycleStatusReason ??
                              'elasticsearch_lifecycle_audit_unavailable',
                          }
                        : {}),
                  };
                })()
              : {
                  status: 'skipped',
                  reason: es.reason ?? 'elasticsearch_disabled',
                },
            milvus,
            image,
            graph,
            retrievalDescriptions,
          };
          const reasons: string[] = [];
          if (expected <= 0) reasons.push('missing_chunks');
          if (indexChecks.postgres.status === 'mismatch')
            reasons.push('metadata_chunk_count_mismatch');
          if (indexChecks.elasticsearch.status === 'mismatch')
            reasons.push(
              indexChecks.elasticsearch.reason ??
                'elasticsearch_index_count_mismatch',
            );
          if (indexChecks.image.status === 'mismatch')
            reasons.push('image_index_count_mismatch');
          if (indexChecks.image.status === 'unavailable')
            reasons.push('image_index_unavailable');
          if (indexChecks.graph.status === 'mismatch')
            reasons.push('graph_index_missing');
          if (indexChecks.retrievalDescriptions.status === 'mismatch') {
            reasons.push(...descriptionReasons);
          }
          if (indexChecks.retrievalDescriptions.status === 'unavailable') {
            reasons.push('retrieval_description_audit_unavailable');
          }
          if (doc.graphIndexStatus === 'failed')
            reasons.push('graph_index_failed');
          if (doc.graphIndexStatus === 'pending')
            reasons.push('graph_index_pending');
          if (
            doc.lifecycleStatus === 'effective' &&
            doc.reviewStatus !== 'approved'
          )
            reasons.push('effective_without_approval');
          if (
            doc.lifecycleStatus === 'effective' &&
            doc.expiredAt &&
            doc.expiredAt.getTime() <= now
          )
            reasons.push('expired_but_effective');
          return {
            docId: doc.docId,
            filename: doc.filename,
            chunkCount: expected,
            lifecycleStatus: doc.lifecycleStatus,
            reviewStatus: doc.reviewStatus,
            graphIndexStatus: doc.graphIndexStatus,
            checks: indexChecks,
            reasons: [...new Set(reasons)],
          };
        }),
      );
      checks.push(...batchChecks);
    }
    const issues = checks.filter((item) => item.reasons.length > 0);
    const count = (reason: string) =>
      issues.filter((item) => item.reasons.includes(reason)).length;
    return {
      available: true,
      scanned: docs.length,
      nextCursor:
        docs.length === pageSize
          ? {
              createdAt: docs[docs.length - 1].createdAt.toISOString(),
              docId: docs[docs.length - 1].docId,
            }
          : null,
      issueCount: issues.length,
      counts: {
        missingChunks: count('missing_chunks'),
        graphIndexFailed: count('graph_index_failed'),
        graphIndexPending: count('graph_index_pending'),
        effectiveWithoutApproval: count('effective_without_approval'),
        expiredButEffective: count('expired_but_effective'),
        metadataChunkCountMismatch: count('metadata_chunk_count_mismatch'),
        bm25ChunkCountMismatch: count('bm25_chunk_count_mismatch'),
        bm25SnapshotNotPersisted: count('bm25_snapshot_not_persisted'),
        elasticsearchIndexCountMismatch: count(
          'elasticsearch_index_count_mismatch',
        ),
        milvusChunkCountMismatch: count('milvus_chunk_count_mismatch'),
        bm25ContentHashMismatch: count('bm25_content_hash_mismatch'),
        elasticsearchContentHashMismatch: count(
          'elasticsearch_content_hash_mismatch',
        ),
        bm25GenerationMismatch: count('bm25_generation_mismatch'),
        bm25LifecycleMismatch: count('bm25_lifecycle_mismatch'),
        elasticsearchGenerationMismatch: count(
          'elasticsearch_generation_mismatch',
        ),
        elasticsearchLifecycleMismatch: count(
          'elasticsearch_lifecycle_mismatch',
        ),
        milvusUnavailable: count('milvus_unavailable'),
        imageIndexCountMismatch: count('image_index_count_mismatch'),
        imageIndexUnavailable: count('image_index_unavailable'),
        graphIndexMissing: count('graph_index_missing'),
        retrievalDescriptionMismatch: issues.filter((item) =>
          item.reasons.some((reason) =>
            reason.startsWith('retrieval_description_'),
          ),
        ).length,
      },
      issues,
      checks,
      repairActions: [
        'POST /rag/admin/documents/:docId/reindex',
        'POST /rag/admin/documents/tasks/:taskId/retry',
      ],
    };
  }

  private async readIndexCheck(
    available: boolean,
    read: () => Promise<number>,
    expected: number,
    indexName: string,
  ): Promise<IndexAuditCheck> {
    if (!available) {
      return {
        status: 'unavailable',
        expected,
        reason: `${indexName}_unavailable`,
      };
    }
    try {
      const actual = await read();
      return {
        status: actual === expected ? 'ok' : 'mismatch',
        expected,
        actual,
        ...(actual === expected
          ? {}
          : { reason: `${indexName}_count_mismatch` }),
      };
    } catch (err) {
      return {
        status: 'unavailable',
        expected,
        reason: `${indexName}_unavailable:${(err as Error).message}`,
      };
    }
  }

  private async readGraphIndexCheck(
    graphIndexStatus: DocumentMetaEntity['graphIndexStatus'],
    docId: string,
    userId: string,
  ): Promise<IndexAuditCheck> {
    if (!this.context.graphService.isEnabled()) {
      return { status: 'skipped', reason: 'graph_disabled' };
    }
    if (graphIndexStatus !== 'indexed') {
      return {
        status: graphIndexStatus === 'failed' ? 'mismatch' : 'skipped',
        sourcePresent: false,
        reason: `graph_status_${graphIndexStatus}`,
      };
    }
    try {
      const result = await this.context.graphService.getSourceIndexStatus(
        docId,
        userId,
      );
      return {
        status: result.sourcePresent ? 'ok' : 'mismatch',
        actual: result.nodeCount + result.relationshipCount,
        sourcePresent: result.sourcePresent,
        reason: result.sourcePresent ? undefined : 'graph_source_missing',
      };
    } catch (err) {
      return {
        status: 'unavailable',
        reason: `graph_unavailable:${(err as Error).message}`,
      };
    }
  }
}
