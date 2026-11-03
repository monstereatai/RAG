import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import type {
  RagChunkMetadataPatch,
  RagIndexCapability,
  RagIndexChunkInput,
} from '../contracts/rag-capabilities';
import { Bm25Store, Bm25PersistedEntry } from './bm25-store';
import type {
  RagChunkMetadata,
  RagIndexedChunkMeta,
  RankedRetrievalHit,
} from './rag-index.types';
import { BM25, BM25Doc } from './bm25.util';

function pickChunkMetadata(
  chunk: Partial<RagIndexedChunkMeta>,
): RagChunkMetadata {
  return {
    parentChunkId: chunk.parentChunkId,
    headingPath: chunk.headingPath,
    sectionId: chunk.sectionId,
    clauseId: chunk.clauseId,
    tableRef: chunk.tableRef,
    sourceStart: chunk.sourceStart,
    sourceEnd: chunk.sourceEnd,
    sourceMetadata: chunk.sourceMetadata,
    docVersion: chunk.docVersion,
    effectiveAt: chunk.effectiveAt,
    expiredAt: chunk.expiredAt,
    sourceAuthority: chunk.sourceAuthority,
    projectId: chunk.projectId,
    activityId: chunk.activityId,
    region: chunk.region,
    locale: chunk.locale,
    channel: chunk.channel,
    roleScope: chunk.roleScope,
    documentType: chunk.documentType,
    lifecycleStatus: chunk.lifecycleStatus,
    supersedesDocId: chunk.supersedesDocId,
    contentHash: chunk.contentHash,
    indexGeneration: chunk.indexGeneration,
    ruleKey: chunk.ruleKey,
    changeType: chunk.changeType,
    supersedesChunkId: chunk.supersedesChunkId,
    hypotheticalQuestions: chunk.hypotheticalQuestions,
  };
}

@Injectable()
export class RagIndexService implements OnModuleInit, RagIndexCapability {
  private readonly logger = new Logger(RagIndexService.name);
  private readonly bm25Instances = new Map<string, BM25>();
  private readonly globalBm25 = new BM25();
  private readonly chunkMeta = new Map<string, RagIndexedChunkMeta>();
  private persistedEntries: Bm25PersistedEntry[] = [];
  private readonly snapshotPersistenceErrors = new Map<string, string>();
  private bm25Store?: Bm25Store;
  private initialized = false;
  private readonly localBm25Enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const nodeEnv =
      configService.get<string>('nodeEnv') ??
      process.env.NODE_ENV ??
      'development';
    this.localBm25Enabled = nodeEnv !== 'production';
  }

  private getBm25Instance(userId?: string): BM25 {
    const key = userId || 'default';
    let instance = this.bm25Instances.get(key);
    if (!instance) {
      instance = new BM25();
      this.bm25Instances.set(key, instance);
    }
    return instance;
  }

  getChunkMeta(): ReadonlyMap<string, RagIndexedChunkMeta> {
    return this.chunkMeta;
  }

  getPersistedEntries(): readonly Bm25PersistedEntry[] {
    return this.persistedEntries;
  }

  onModuleInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.localBm25Enabled) {
      this.logger.log(
        'Local BM25 is disabled in production; Elasticsearch is the primary keyword index',
      );
      return;
    }
    const uploadDir =
      this.configService.get<string>('workspace.uploadDir') ??
      path.resolve(process.cwd(), '../../workspace/uploads');
    const workspaceDir = path.dirname(uploadDir);
    this.bm25Store = new Bm25Store(workspaceDir);

    const stored = this.bm25Store.load();
    if (stored && stored.entries.length > 0) {
      this.logger.log(
        `Restoring BM25 index from disk: ${stored.entries.length} chunks (${stored.updatedAt})`,
      );
      this._loadEntries(stored.entries);
    } else {
      this.logger.log('No BM25 snapshot found, starting empty index');
    }
  }

  /**
   * 内部：将持久化条目加载到内存索引
   */
  private _loadEntries(entries: Bm25PersistedEntry[]): void {
    for (const entry of entries) {
      const doc: BM25Doc = {
        id: entry.id,
        content: entry.content,
        searchText: `${entry.content}\n${(entry.hypotheticalQuestions ?? []).join('\n')}`,
      };
      this.getBm25Instance(entry.userId).addDocs([doc]);
      this.globalBm25.addDocs([doc]);
      this.chunkMeta.set(entry.id, {
        content: entry.content,
        docId: entry.docId,
        chunkIndex: entry.chunkIndex,
        userId: entry.userId,
        parentChunkId: entry.parentChunkId,
        headingPath: entry.headingPath,
        sectionId: entry.sectionId,
        clauseId: entry.clauseId,
        tableRef: entry.tableRef,
        sourceStart: entry.sourceStart,
        sourceEnd: entry.sourceEnd,
        sourceMetadata: entry.sourceMetadata,
        docVersion: entry.docVersion,
        effectiveAt: entry.effectiveAt,
        expiredAt: entry.expiredAt,
        sourceAuthority: entry.sourceAuthority,
        projectId: entry.projectId,
        activityId: entry.activityId,
        region: entry.region,
        locale: entry.locale,
        channel: entry.channel,
        roleScope: entry.roleScope,
        documentType: entry.documentType,
        lifecycleStatus: entry.lifecycleStatus,
        supersedesDocId: entry.supersedesDocId,
        contentHash: entry.contentHash,
        indexGeneration: entry.indexGeneration,
        ruleKey: entry.ruleKey,
        changeType: entry.changeType,
        supersedesChunkId: entry.supersedesChunkId,
        hypotheticalQuestions: entry.hypotheticalQuestions,
      });
      const normalizedEntry = { ...entry };
      delete normalizedEntry.parentContent;
      this.persistedEntries.push(normalizedEntry);
    }
  }

  /**
   * 文档上传后调用：把 chunks 加入 BM25 索引并持久化
   */
  indexChunks(chunks: RagIndexChunkInput[], userId?: string): void {
    if (!this.localBm25Enabled) return;
    const docs: BM25Doc[] = chunks.map((c) => ({
      id: c.id,
      content: c.content,
      searchText: `${c.content}\n${(c.hypotheticalQuestions ?? []).join('\n')}`,
    }));
    this.getBm25Instance(userId).addDocs(docs);
    this.globalBm25.addDocs(docs);
    for (const c of chunks) {
      this.chunkMeta.set(c.id, {
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        userId,
        parentChunkId: c.parentChunkId,
        headingPath: c.headingPath,
        sectionId: c.sectionId,
        clauseId: c.clauseId,
        tableRef: c.tableRef,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        sourceMetadata: c.sourceMetadata,
        docVersion: c.docVersion,
        effectiveAt: c.effectiveAt?.toISOString() ?? null,
        expiredAt: c.expiredAt?.toISOString() ?? null,
        sourceAuthority: c.sourceAuthority,
        projectId: c.projectId,
        activityId: c.activityId,
        region: c.region,
        locale: c.locale,
        channel: c.channel,
        roleScope: c.roleScope,
        documentType: c.documentType,
        lifecycleStatus: c.lifecycleStatus,
        supersedesDocId: c.supersedesDocId,
        contentHash: c.contentHash,
        indexGeneration: c.indexGeneration,
        ruleKey: c.ruleKey,
        changeType: c.changeType,
        supersedesChunkId: c.supersedesChunkId,
        hypotheticalQuestions: c.hypotheticalQuestions,
      });
      this.persistedEntries.push({
        id: c.id,
        content: c.content,
        docId: c.docId,
        chunkIndex: c.chunkIndex,
        tokens: [], // tokens 由 BM25 内部管理，此处存空数组即可
        userId,
        parentChunkId: c.parentChunkId,
        headingPath: c.headingPath,
        sectionId: c.sectionId,
        clauseId: c.clauseId,
        tableRef: c.tableRef,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        sourceMetadata: c.sourceMetadata,
        docVersion: c.docVersion,
        effectiveAt: c.effectiveAt?.toISOString() ?? null,
        expiredAt: c.expiredAt?.toISOString() ?? null,
        sourceAuthority: c.sourceAuthority,
        projectId: c.projectId,
        activityId: c.activityId,
        region: c.region,
        locale: c.locale,
        channel: c.channel,
        roleScope: c.roleScope,
        documentType: c.documentType,
        lifecycleStatus: c.lifecycleStatus,
        supersedesDocId: c.supersedesDocId,
        contentHash: c.contentHash,
        indexGeneration: c.indexGeneration,
        ruleKey: c.ruleKey,
        changeType: c.changeType,
        supersedesChunkId: c.supersedesChunkId,
        hypotheticalQuestions: c.hypotheticalQuestions,
      });
    }

    // 主索引写入必须确认快照落盘；否则上层不能把入库标记为完成。
    this.persistEntries(new Set(chunks.map((chunk) => chunk.docId)));
    this.logger.log(
      `BM25 index saved: ${this.persistedEntries.length} total chunks`,
    );

    this.logger.log(
      `Indexed ${chunks.length} chunks into BM25 (total: ${this.chunkMeta.size})`,
    );
  }

  /**
   * 删除指定 docId 的所有 chunks（BM25 内存 + 持久化）
   */
  removeDocChunks(docId: string, userId?: string): void {
    if (!this.localBm25Enabled) return;
    // 过滤内存数据
    this.persistedEntries = this.persistedEntries.filter(
      (e) => e.docId !== docId,
    );
    // 删除 chunkMeta 中属于该 doc 的条目
    for (const [id, meta] of this.chunkMeta.entries()) {
      if (meta.docId === docId) {
        this.chunkMeta.delete(id);
      }
    }
    // 重建该用户的 BM25（BM25 不支持增量删除，需针对该用户全量重建）
    const bm25 = this.getBm25Instance(userId);
    bm25.clear();
    const docs: BM25Doc[] = this.persistedEntries
      .filter((e) => e.userId === userId)
      .map((e) => ({
        id: e.id,
        content: e.content,
      }));
    if (docs.length > 0) {
      bm25.addDocs(docs);
    }
    this.globalBm25.clear();
    this.globalBm25.addDocs(
      this.persistedEntries.map((entry) => ({
        id: entry.id,
        content: entry.content,
        searchText: `${entry.content}\n${(entry.hypotheticalQuestions ?? []).join('\n')}`,
      })),
    );

    // 持久化
    try {
      this.persistEntries(new Set([docId]));
      this.logger.log(
        `BM25 index updated after doc delete: docId=${docId}, remaining=${this.persistedEntries.length} chunks`,
      );
    } catch (err) {
      this.logger.warn(`BM25 save failed: ${(err as Error).message}`);
    }
  }

  /**
   * 按 chunk id 删除 BM25 条目，仅重建受影响用户的 BM25。
   * BM25 内核不支持单文档删除，因此仍要做用户级重建；但索引存储只删除指定 chunk。
   */
  removeChunkIds(ids: string[], userId?: string): void {
    if (!this.localBm25Enabled) return;
    const idSet = new Set(ids.filter(Boolean));
    if (idSet.size === 0) return;
    const affectedDocIds = new Set(
      this.persistedEntries
        .filter((entry) => idSet.has(entry.id))
        .map((entry) => entry.docId),
    );
    for (const id of idSet) {
      const docId = this.chunkMeta.get(id)?.docId;
      if (docId) affectedDocIds.add(docId);
    }
    this.persistedEntries = this.persistedEntries.filter(
      (entry) => idSet.has(entry.id) === false,
    );
    for (const id of idSet) this.chunkMeta.delete(id);
    const bm25 = this.getBm25Instance(userId);
    bm25.clear();
    const docs: BM25Doc[] = this.persistedEntries
      .filter((entry) => entry.userId === userId)
      .map((entry) => ({
        id: entry.id,
        content: entry.content,
        searchText: `${entry.content}\n${(entry.hypotheticalQuestions ?? []).join('\n')}`,
      }));
    if (docs.length > 0) bm25.addDocs(docs);
    this.globalBm25.clear();
    this.globalBm25.addDocs(
      this.persistedEntries.map((entry) => ({
        id: entry.id,
        content: entry.content,
        searchText: `${entry.content}\n${(entry.hypotheticalQuestions ?? []).join('\n')}`,
      })),
    );
    try {
      this.persistEntries(affectedDocIds);
    } catch (err) {
      this.logger.warn(`BM25 save failed: ${(err as Error).message}`);
    }
  }

  /** 更新 chunk 元数据，不重新分词、不重写正文和向量。 */
  updateChunkMetadataByIds(ids: string[], patch: RagChunkMetadataPatch): void {
    if (!this.localBm25Enabled) return;
    const idSet = new Set(ids.filter(Boolean));
    if (idSet.size === 0) return;
    const affectedDocIds = new Set(
      this.persistedEntries
        .filter((entry) => idSet.has(entry.id))
        .map((entry) => entry.docId),
    );
    for (const id of idSet) {
      const docId = this.chunkMeta.get(id)?.docId;
      if (docId) affectedDocIds.add(docId);
    }
    this.persistedEntries = this.persistedEntries.map((entry) =>
      idSet.has(entry.id) ? { ...entry, ...patch } : entry,
    );
    for (const [id, meta] of this.chunkMeta.entries()) {
      if (idSet.has(id)) this.chunkMeta.set(id, { ...meta, ...patch });
    }
    this.persistEntries(affectedDocIds);
  }

  updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): void {
    if (!this.localBm25Enabled) return;
    let changed = false;
    this.persistedEntries = this.persistedEntries.map((entry) => {
      if (entry.docId !== docId || entry.userId !== userId) return entry;
      changed = true;
      return { ...entry, lifecycleStatus };
    });
    for (const meta of this.chunkMeta.values()) {
      if (meta.docId === docId && meta.userId === userId) {
        meta.lifecycleStatus = lifecycleStatus;
      }
    }
    if (changed) this.persistEntries(new Set([docId]));
  }

  /**
   * 统一混合检索入口。
   *
   * 先召回关键词与向量候选，再经权限、来源权威性、业务 Scope（范围）过滤；
   * RRF（倒数排名融合）仅合并候选，不替代权限判断。最后才按预算扩展上下文并可选重排。
   */

  getIndexedDocIds(): Set<string> {
    return new Set(this.persistedEntries.map((e) => e.docId));
  }

  /** 返回某个文档在持久化 BM25 快照中的分块数量，用于索引对账。 */
  getIndexedChunkCount(docId: string, userId?: string): number {
    return this.persistedEntries.filter(
      (entry) => entry.docId === docId && (!userId || entry.userId === userId),
    ).length;
  }

  getSnapshotPersistenceStatus(docId: string): {
    persisted: boolean;
    reason?: string;
  } {
    const reason = this.snapshotPersistenceErrors.get(docId);
    if (reason) return { persisted: false, reason };
    if (!this.bm25Store) {
      return {
        persisted: false,
        reason: 'BM25 snapshot store is not initialized',
      };
    }
    return { persisted: true };
  }

  getIndexedChunkHashes(
    docId: string,
    userId?: string,
  ): {
    hashes: string[];
    generations: string[];
    lifecycleStatuses: string[];
    complete: boolean;
  } {
    const entries = this.persistedEntries.filter(
      (entry) => entry.docId === docId && (!userId || entry.userId === userId),
    );
    return {
      hashes: entries.flatMap((entry) =>
        entry.contentHash ? [entry.contentHash] : [],
      ),
      generations: [
        ...new Set(
          entries.flatMap((entry) =>
            entry.indexGeneration ? [entry.indexGeneration] : [],
          ),
        ),
      ],
      lifecycleStatuses: [
        ...new Set(
          entries.flatMap((entry) =>
            entry.lifecycleStatus ? [entry.lifecycleStatus] : [],
          ),
        ),
      ],
      complete:
        entries.length === 0 ||
        entries.every((entry) => Boolean(entry.contentHash)),
    };
  }

  /** 获取 BM25 索引统计信息（供运营 API 使用） */
  getStats(): { totalChunks: number; totalDocs: number } {
    const docIds = new Set(this.persistedEntries.map((e) => e.docId));
    return {
      totalChunks: this.persistedEntries.length,
      totalDocs: docIds.size,
    };
  }

  hasIndexedChunks(userId?: string): boolean {
    return this.persistedEntries.some((entry) => entry.userId === userId);
  }

  /**
   * Auto 的前置取证：并发准备纠错案例、Hybrid 检索和 Obsidian，
   * 把原问题的证据及判断打包供后续复用，避免升级 Agentic 后重复查询。
   */

  searchLocalBm25(
    normalizedQuery: string,
    userId?: string,
    limit = 10,
    allowedDocIds?: ReadonlySet<string>,
  ): RankedRetrievalHit[] {
    if (!this.localBm25Enabled) return [];
    const bm25 =
      allowedDocIds != null || userId == null
        ? this.globalBm25
        : this.getBm25Instance(userId);
    const searchLimit =
      allowedDocIds == null
        ? limit
        : Math.max(limit, this.persistedEntries.length);
    return bm25
      .search(normalizedQuery, searchLimit)
      .flatMap((hit): RankedRetrievalHit[] => {
        const meta = this.chunkMeta.get(hit.id);
        if (meta == null) return [];
        if (allowedDocIds != null) {
          if (allowedDocIds.has(meta.docId) === false) return [];
        } else if (userId != null && meta.userId !== userId) {
          return [];
        }
        const result: RankedRetrievalHit = {
          id: hit.id,
          score: hit.score,
          content: meta.content,
          docId: meta.docId,
          chunkIndex: meta.chunkIndex,
          ...pickChunkMetadata(meta),
        };
        return [result];
      })
      .filter(
        (hit): hit is RankedRetrievalHit =>
          hit.lifecycleStatus !== 'draft' && hit.lifecycleStatus !== 'archived',
      )
      .slice(0, limit);
  }

  private persistEntries(affectedDocIds: ReadonlySet<string>): void {
    if (this.bm25Store == null) {
      const reason = 'BM25 snapshot store is not initialized';
      this.markSnapshotPersistenceFailure(affectedDocIds, reason);
      throw new Error(reason);
    }
    try {
      this.bm25Store.save(this.persistedEntries);
      // The snapshot contains all current entries, so one successful full save
      // also resolves failures recorded by earlier writes.
      this.snapshotPersistenceErrors.clear();
    } catch (err) {
      const reason = (err as Error).message;
      this.markSnapshotPersistenceFailure(affectedDocIds, reason);
      throw err;
    }
  }

  private markSnapshotPersistenceFailure(
    affectedDocIds: ReadonlySet<string>,
    reason: string,
  ): void {
    // save() overwrites the complete JSON file, so a failed write can leave
    // any part of the snapshot incomplete, not only the changed document.
    const uncertainDocIds = new Set([
      ...this.persistedEntries.map((entry) => entry.docId),
      ...affectedDocIds,
    ]);
    for (const docId of uncertainDocIds) {
      this.snapshotPersistenceErrors.set(docId, reason);
    }
  }
}
