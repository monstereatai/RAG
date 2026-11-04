import { Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { GraphService } from '../graph/graph.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { DocumentTaskService } from './document-task.service';
import type { HybridChunk } from './hybrid-document-chunker';
import {
  DocumentLifecycleStatus,
  type DocumentBusinessMetadata,
  type GameDocumentMetadata,
  type ResolvedDocumentBusinessMetadata,
} from './document-profile.util';
import type {
  DocumentGovernanceMetadata,
  FactConflictDraft,
  IncrementalChunkDraft,
  UploadOptions,
  UploadResult,
} from './document.service.types';
import type { EntityManager, Repository } from 'typeorm';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { DOCUMENT_SEARCH_INDEX_UPSERT_EVENT } from './document-search-index.events';

interface DocumentChunkWorkflowContext {
  docChunkRepo: Repository<DocumentChunkEntity>;
  docMetaRepo: Repository<DocumentMetaEntity>;
  documentIndexCoordinator: DocumentIndexCoordinator;
  documentTaskService: DocumentTaskService;
  domainEvents: DomainEventsService;
  factConflictRepo: Repository<FactConflictEntity>;
  graphService: GraphService;
  logger: Logger;
  rebuildRetrievalDescriptions: (
    tenantId: string,
    docId: string,
  ) => Promise<void>;
  scheduleOptionalGraphIndex: (params: {
    docId: string;
    userId: string;
    indexGeneration: string;
  }) => void;
}

export class DocumentChunkWorkflow {
  constructor(private readonly context: DocumentChunkWorkflowContext) {}

  private createParentEntities(
    entries: Array<{
      leaf: DocumentChunkEntity;
      parentContent?: string | null;
    }>,
    repository: Repository<DocumentChunkEntity>,
  ): DocumentChunkEntity[] {
    const parents = new Map<string, DocumentChunkEntity>();
    for (const { leaf, parentContent } of entries) {
      if (
        !leaf.parentChunkId ||
        !parentContent ||
        parentContent === leaf.content
      ) {
        continue;
      }
      const existing = parents.get(leaf.parentChunkId);
      if (existing) {
        if (existing.content !== parentContent) {
          throw new Error(
            `parent chunk id maps to different content: ${leaf.parentChunkId}`,
          );
        }
        existing.chunkIndex = Math.min(existing.chunkIndex, leaf.chunkIndex);
        continue;
      }
      parents.set(
        leaf.parentChunkId,
        repository.create({
          ...leaf,
          id: leaf.parentChunkId,
          parentChunkId: null,
          chunkType: 'parent',
          chunkIndex: leaf.chunkIndex,
          content: parentContent,
          contentHash: createHash('sha256').update(parentContent).digest('hex'),
          parentContent: null,
          hypotheticalQuestions: null,
        }),
      );
    }
    return [...parents.values()];
  }

  public buildHypotheticalQuestions(
    content: string,
    headingPath?: string[],
  ): string[] {
    const text = content.replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const topic =
      headingPath?.filter(Boolean).slice(-1)[0] ?? text.slice(0, 48);
    const questions = [
      `${topic} 的核心内容是什么？`,
      `如何理解或使用 ${topic}？`,
    ];
    return questions.filter(
      (question, index) => index === 0 || text.length > 80,
    );
  }

  public async applyIncrementalChunkUpdate(input: {
    docId: string;
    userId: string;
    tenantId: string;
    filename: string;
    content: string;
    contentSha256: string;
    indexGeneration: string;
    chunkDocs: IncrementalChunkDraft[];
    governance: DocumentGovernanceMetadata;
    taskId: string;
    options: UploadOptions;
  }): Promise<UploadResult> {
    const existing = await this.context.docMetaRepo.findOne({
      where: { docId: input.docId, userId: input.userId },
    });
    if (existing === null) {
      throw new Error(
        'incremental update requires an existing document with the same docId',
      );
    }
    const oldChunks = await this.context.docChunkRepo.find({
      where: { docId: input.docId, userId: input.userId, chunkType: 'leaf' },
      order: { chunkIndex: 'ASC' },
    });
    if (oldChunks.length === 0) {
      throw new Error(
        'incremental update requires existing chunks; use the normal upload path first',
      );
    }
    const now = new Date();
    const requestedChangeType =
      input.options.businessMetadata?.changeType ?? 'amend';
    const effectiveAt = input.governance.effectiveAt ?? now;
    const activeOld = oldChunks.filter((chunk) => {
      if (chunk.expiredAt === null || chunk.expiredAt === undefined) {
        return true;
      }
      return new Date(chunk.expiredAt).getTime() > now.getTime();
    });
    const oldByHash = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of activeOld) {
      if (chunk.contentHash === null || chunk.contentHash === undefined) {
        continue;
      }
      const list = oldByHash.get(chunk.contentHash) ?? [];
      list.push(chunk);
      oldByHash.set(chunk.contentHash, list);
    }
    const oldByRule = new Map<string, DocumentChunkEntity[]>();
    const oldByIndex = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of activeOld) {
      const key =
        chunk.ruleKey || chunk.sectionId || `chunk-${chunk.chunkIndex}`;
      const list = oldByRule.get(key) ?? [];
      list.push(chunk);
      oldByRule.set(key, list);
      const indexKey = String(chunk.chunkIndex);
      const indexList = oldByIndex.get(indexKey) ?? [];
      indexList.push(chunk);
      oldByIndex.set(indexKey, indexList);
    }
    for (const list of oldByRule.values()) {
      list.sort(
        (left, right) =>
          new Date(right.effectiveAt ?? right.createdAt).getTime() -
          new Date(left.effectiveAt ?? left.createdAt).getTime(),
      );
    }
    for (const list of oldByIndex.values()) {
      list.sort(
        (left, right) =>
          new Date(right.effectiveAt ?? right.createdAt).getTime() -
          new Date(left.effectiveAt ?? left.createdAt).getTime(),
      );
    }
    const consumed = new Set<string>();
    const expireIds = new Set<string>();
    const newDrafts: IncrementalChunkDraft[] = [];
    let unchanged = 0;

    const pickOldByHash = (
      draft: IncrementalChunkDraft,
    ): DocumentChunkEntity | undefined => {
      const list = oldByHash.get(draft.contentHash) ?? [];
      const candidate = list.find(
        (chunk) =>
          consumed.has(chunk.id) === false &&
          chunk.parentChunkId === draft.parentChunkId,
      );
      if (candidate) consumed.add(candidate.id);
      return candidate;
    };

    const pickOldByRule = (
      ruleKey: string,
      chunkIndex: number,
    ): DocumentChunkEntity | undefined => {
      const list = oldByRule.get(ruleKey) ?? [];
      const candidate =
        list.find((chunk) => consumed.has(chunk.id) === false) ??
        (oldByIndex.get(String(chunkIndex)) ?? []).find(
          (chunk) => consumed.has(chunk.id) === false,
        );
      if (candidate) consumed.add(candidate.id);
      return candidate;
    };

    if (requestedChangeType === 'deprecate') {
      for (const chunk of activeOld) expireIds.add(chunk.id);
    } else if (requestedChangeType === 'supplement') {
      for (const draft of input.chunkDocs) {
        const sameContent = pickOldByHash(draft);
        if (sameContent) {
          unchanged += 1;
          continue;
        }
        const old = pickOldByRule(
          draft.ruleKey || draft.sectionId || `chunk-${draft.chunkIndex}`,
          draft.chunkIndex,
        );
        if (old) expireIds.delete(old.id);
        newDrafts.push({
          ...draft,
          changeType: 'supplement',
          supersedesChunkId: old?.id ?? null,
          effectiveAt: draft.effectiveAt ?? effectiveAt,
        });
      }
    } else if (requestedChangeType === 'replace') {
      for (const chunk of activeOld) expireIds.add(chunk.id);
      for (const draft of input.chunkDocs) {
        const old = pickOldByRule(
          draft.ruleKey || draft.sectionId || `chunk-${draft.chunkIndex}`,
          draft.chunkIndex,
        );
        newDrafts.push({
          ...draft,
          changeType: 'replace',
          supersedesChunkId: old?.id ?? null,
          effectiveAt: draft.effectiveAt ?? effectiveAt,
        });
      }
    } else {
      for (const draft of input.chunkDocs) {
        const sameContent = pickOldByHash(draft);
        if (sameContent) {
          unchanged += 1;
          continue;
        }
        const old = pickOldByRule(
          draft.ruleKey || draft.sectionId || `chunk-${draft.chunkIndex}`,
          draft.chunkIndex,
        );
        if (old) expireIds.add(old.id);
        newDrafts.push({
          ...draft,
          changeType: requestedChangeType,
          supersedesChunkId: old?.id ?? null,
          effectiveAt: draft.effectiveAt ?? effectiveAt,
        });
      }
      for (const chunk of activeOld) {
        if (consumed.has(chunk.id) === false) expireIds.add(chunk.id);
      }
    }

    const newEntities = newDrafts.map((draft) =>
      this.context.docChunkRepo.create({
        id: draft.id,
        tenantId: input.tenantId,
        docId: input.docId,
        userId: input.userId,
        parentChunkId: draft.parentChunkId,
        chunkIndex: draft.chunkIndex,
        chunkType: 'leaf',
        content: draft.content,
        contentHash: draft.contentHash,
        indexGeneration: input.indexGeneration,
        ruleKey: draft.ruleKey,
        changeType: draft.changeType,
        supersedesChunkId: draft.supersedesChunkId,
        headingPath:
          draft.headingPath.length > 0
            ? JSON.stringify(draft.headingPath)
            : null,
        sectionId: draft.sectionId,
        clauseId: draft.clauseId,
        tableRef: draft.tableRef,
        sourceStart: draft.sourceStart,
        sourceEnd: draft.sourceEnd,
        parentContent: null,
        sourceMetadata: draft.sourceMetadata ?? null,
        docVersion: input.governance.docVersion,
        effectiveAt: draft.effectiveAt,
        expiredAt: draft.expiredAt,
        sourceAuthority: input.governance.sourceAuthority,
        projectId: input.governance.projectId,
        activityId: input.governance.activityId,
        region: input.governance.region,
        locale: input.governance.locale,
        channel: input.governance.channel,
        roleScope:
          input.governance.roleScope.length > 0
            ? JSON.stringify(input.governance.roleScope)
            : null,
        documentType: input.governance.documentType,
        lifecycleStatus: existing.lifecycleStatus,
        supersedesDocId: input.governance.supersedesDocId,
        hypotheticalQuestions:
          draft.hypotheticalQuestions.length > 0
            ? JSON.stringify(draft.hypotheticalQuestions)
            : null,
      }),
    );

    const vectors =
      newDrafts.length > 0
        ? await this.context.documentIndexCoordinator.embedChunks(
            newDrafts.map((draft) => draft.content),
          )
        : [];
    if (vectors.length !== newDrafts.length) {
      throw new Error(
        'incremental embedding count does not match changed chunks',
      );
    }

    let totalChunkCount = oldChunks.length + newEntities.length;
    const parentEntities = this.createParentEntities(
      newEntities.map((leaf, index) => ({
        leaf,
        parentContent: newDrafts[index]?.parentContent,
      })),
      this.context.docChunkRepo,
    );
    await this.context.docChunkRepo.manager.transaction(async (manager) => {
      if (expireIds.size > 0) {
        await manager
          .getRepository(DocumentChunkEntity)
          .update({ id: In([...expireIds]) }, { expiredAt: effectiveAt });
      }
      if (parentEntities.length > 0 || newEntities.length > 0) {
        await manager
          .getRepository(DocumentChunkEntity)
          .save([...parentEntities, ...newEntities]);
      }
      totalChunkCount = await manager.getRepository(DocumentChunkEntity).count({
        where: { docId: input.docId, userId: input.userId, chunkType: 'leaf' },
      });
      await manager.getRepository(DocumentMetaEntity).update(
        { docId: input.docId },
        {
          filename: input.filename,
          contentHash: input.contentSha256,
          indexGeneration: input.indexGeneration,
          changeType: requestedChangeType,
          chunkCount: totalChunkCount,
          docVersion: input.governance.docVersion ?? existing.docVersion,
          effectiveAt: input.governance.effectiveAt ?? existing.effectiveAt,
          expiredAt: input.governance.expiredAt ?? existing.expiredAt,
          supersedesDocId:
            input.governance.supersedesDocId ?? existing.supersedesDocId,
          graphIndexStatus: this.context.graphService.isEnabled()
            ? 'pending'
            : 'skipped',
          graphIndexError: null,
        },
      );
      await this.context.domainEvents.emitInTransaction(manager, {
        tenantId: input.tenantId,
        eventType: DOCUMENT_SEARCH_INDEX_UPSERT_EVENT,
        aggregateType: 'document',
        aggregateId: input.docId,
        payload: {
          userId: input.userId,
          indexGeneration: input.indexGeneration,
        },
      });
    });

    if (expireIds.size > 0) {
      await this.context.documentIndexCoordinator.updateChunkMetadataByIds(
        [...expireIds],
        { expiredAt: effectiveAt.toISOString() },
      );
    }

    const records = newDrafts.map((draft, index) => ({
      id: draft.id,
      vector: vectors[index],
      content: draft.content,
      docId: input.docId,
      chunkIndex: draft.chunkIndex,
      userId: input.userId,
    }));
    await this.context.documentIndexCoordinator.writeIncrementalIndexes({
      records,
      chunks: newDrafts,
      userId: input.userId,
      vectors,
      document: {
        docId: input.docId,
        filename: input.filename,
        content: input.content,
        userId: input.userId,
        tenantId: input.tenantId,
        title: existing.title ?? input.filename,
        summary: existing.summary,
        sourceAuthority: input.governance.sourceAuthority,
        projectId: input.governance.projectId,
        activityId: input.governance.activityId,
        region: input.governance.region,
        locale: input.governance.locale,
        channel: input.governance.channel,
        roleScope: input.governance.roleScope,
        documentType: input.governance.documentType,
        lifecycleStatus: existing.lifecycleStatus,
        docVersion: input.governance.docVersion ?? existing.docVersion,
        contentHash: input.contentSha256,
        indexGeneration: input.indexGeneration,
        effectiveAt: input.governance.effectiveAt ?? existing.effectiveAt,
        expiredAt: input.governance.expiredAt ?? existing.expiredAt,
      },
    });
    await this.context.rebuildRetrievalDescriptions(
      input.tenantId,
      input.docId,
    );

    if (this.context.graphService.isEnabled()) {
      this.context.scheduleOptionalGraphIndex({
        docId: input.docId,
        userId: input.userId,
        indexGeneration: input.indexGeneration,
      });
    }

    await this.context.documentTaskService.updateTask(input.taskId, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      chunkCount: totalChunkCount,
      finishedAt: new Date(),
    });

    this.context.logger.log(
      `Incremental update done: docId=${input.docId}, added=${newDrafts.length}, expired=${expireIds.size}, unchanged=${unchanged}, embedded=${newDrafts.length}`,
    );

    return {
      docId: input.docId,
      taskId: input.taskId,
      chunkCount: totalChunkCount,
      docVersion: input.governance.docVersion,
      effectiveAt: input.governance.effectiveAt?.toISOString() ?? null,
      expiredAt: input.governance.expiredAt?.toISOString() ?? null,
      sourceAuthority: input.governance.sourceAuthority,
      projectId: input.governance.projectId,
      activityId: input.governance.activityId,
      region: input.governance.region,
      locale: input.governance.locale,
      channel: input.governance.channel,
      roleScope: input.governance.roleScope,
      documentType: input.governance.documentType,
      lifecycleStatus: existing.lifecycleStatus as DocumentLifecycleStatus,
      graphIndexStatus: existing.graphIndexStatus,
      supersedesDocId: input.governance.supersedesDocId,
      incremental: (() => {
        const changedCount = newDrafts.filter(
          (draft) => draft.supersedesChunkId !== null,
        ).length;
        return {
          added: newDrafts.length - changedCount,
          changed: changedCount,
          removed: Math.max(0, expireIds.size - changedCount),
          unchanged,
          embedded: newDrafts.length,
        };
      })(),
    };
  }

  public async saveChunkMetadata(
    docId: string,
    userId: string,
    records: Array<{
      id: string;
      content: string;
      chunkIndex: number;
      tenantId: string;
      contentHash: string;
      indexGeneration: string;
    }>,
    chunks: HybridChunk[],
    governance: DocumentGovernanceMetadata,
    hypotheticalQuestions: string[][],
    tenantId: string,
    indexGeneration: string,
    manager?: EntityManager,
  ): Promise<void> {
    const chunkRepo = manager
      ? manager.getRepository(DocumentChunkEntity)
      : this.context.docChunkRepo;
    const entities = records.map((record, index) => {
      const chunk = chunks[index];
      return chunkRepo.create({
        id: record.id,
        tenantId,
        docId,
        userId,
        parentChunkId: chunk?.parentChunkId ?? null,
        chunkIndex: record.chunkIndex,
        chunkType: 'leaf',
        content: record.content,
        contentHash: record.contentHash,
        indexGeneration,
        ruleKey: this.resolveRuleKey(chunk, index),
        changeType: governance.changeType ?? 'standalone',
        supersedesChunkId: null,
        headingPath:
          chunk && chunk.headingPath.length > 0
            ? JSON.stringify(chunk.headingPath)
            : null,
        sectionId: chunk?.sectionId ?? null,
        clauseId: chunk?.clauseId ?? null,
        tableRef: chunk?.tableRef ?? null,
        sourceStart: chunk?.sourceStart ?? null,
        sourceEnd: chunk?.sourceEnd ?? null,
        parentContent: null,
        sourceMetadata: chunk?.sourceMetadata
          ? JSON.stringify(chunk.sourceMetadata)
          : null,
        docVersion: governance.docVersion,
        effectiveAt: this.resolveChunkValidity(
          record.content,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).effectiveAt,
        expiredAt: this.resolveChunkValidity(
          record.content,
          governance.effectiveAt,
          governance.expiredAt,
          governance.validityMonths,
        ).expiredAt,
        sourceAuthority: governance.sourceAuthority,
        projectId: governance.projectId,
        activityId: governance.activityId,
        region: governance.region,
        locale: governance.locale,
        channel: governance.channel,
        roleScope:
          governance.roleScope.length > 0
            ? JSON.stringify(governance.roleScope)
            : null,
        documentType: governance.documentType,
        lifecycleStatus: governance.lifecycleStatus,
        supersedesDocId: governance.supersedesDocId,
        hypotheticalQuestions:
          hypotheticalQuestions[index]?.length > 0
            ? JSON.stringify(hypotheticalQuestions[index])
            : null,
      });
    });
    const parentEntities = this.createParentEntities(
      entities.map((leaf, index) => ({
        leaf,
        parentContent: chunks[index]?.parentContent,
      })),
      chunkRepo,
    );
    await chunkRepo.save([...parentEntities, ...entities]);
  }

  public async deprecateSupersededDocument(
    docId: string,
    userId: string,
  ): Promise<void> {
    const exists = await this.context.docMetaRepo.exist({
      where: { docId, userId },
    });
    if (!exists) {
      this.context.logger.warn(`Superseded document not found: docId=${docId}`);
      return;
    }
    await Promise.all([
      this.context.docMetaRepo.update(
        { docId, userId },
        { lifecycleStatus: 'deprecated' },
      ),
      this.context.docChunkRepo.update(
        { docId, userId },
        { lifecycleStatus: 'deprecated' },
      ),
      this.context.documentIndexCoordinator.updateElasticsearchDocumentLifecycle(
        docId,
        'deprecated',
        userId,
      ),
    ]);
    this.context.documentIndexCoordinator.updateBm25DocumentLifecycle(
      docId,
      'deprecated',
      userId,
    );
  }

  public async detectAndSaveFactConflicts(
    docId: string,
    userId: string,
    records: Array<{ id: string; content: string }>,
    governance: DocumentGovernanceMetadata,
  ): Promise<void> {
    const conflicts = records.flatMap((record) =>
      this.detectChunkConflicts(record.content).map((conflict) =>
        this.context.factConflictRepo.create({
          id: randomUUID(),
          userId,
          docId,
          chunkId: record.id,
          subject: conflict.subject,
          predicate: conflict.predicate,
          currentValue: conflict.currentValue,
          conflictingValue: conflict.conflictingValue,
          currentVersion: governance.docVersion,
          conflictingVersion: conflict.conflictingVersion,
          status: 'detected',
          sourceAuthority: governance.sourceAuthority,
        }),
      ),
    );

    if (conflicts.length > 0) {
      await this.context.factConflictRepo.save(conflicts);
    }
  }

  public detectChunkConflicts(content: string): FactConflictDraft[] {
    const years = [...new Set(content.match(/20\d{2}/g) ?? [])];
    if (years.length < 2) {
      return [];
    }

    const amounts = [...new Set(content.match(/\d+(?:\.\d+)?\s*元/g) ?? [])];
    if (amounts.length < 2) {
      return [];
    }

    return [
      {
        subject: this.extractConflictSubject(content),
        predicate: 'versioned_numeric_policy',
        currentValue: amounts[amounts.length - 1],
        conflictingValue: amounts[0],
        conflictingVersion: years[0],
      },
    ];
  }

  public extractConflictSubject(content: string): string {
    const match = /(住宿报销上限|报销上限|绩效奖金|基本工资|审批规则)/.exec(
      content,
    );
    return match?.[1] ?? 'versioned_policy';
  }

  public extractGovernanceMetadata(
    filename: string,
    content: string,
  ): Omit<DocumentGovernanceMetadata, keyof GameDocumentMetadata> {
    return {
      docVersion: this.extractDocVersion(filename, content),
      effectiveAt: this.extractDate(
        content,
        /(?:生效日期|生效时间|effectiveAt)[:：]?\s*(\d{4}-\d{2}-\d{2})/i,
      ),
      expiredAt: this.extractDate(
        content,
        /(?:失效日期|失效时间|expiredAt)[:：]?\s*(\d{4}-\d{2}-\d{2})/i,
      ),
      sourceAuthority: this.extractSourceAuthority(filename, content),
    };
  }

  public extractDocVersion(filename: string, content: string): string | null {
    const haystack = `${filename}\n${content}`;
    const explicit =
      /(?:版本|版次|docVersion|version)[:：]?\s*([A-Za-z0-9._-]+|20\d{2}\s*版)/i.exec(
        haystack,
      );
    if (explicit?.[1]) {
      return explicit[1].replace(/\s+/g, '');
    }
    return haystack.match(/20\d{2}\s*版/)?.[0]?.replace(/\s+/g, '') ?? null;
  }

  public extractDate(text: string, pattern: RegExp): Date | null {
    const value = pattern.exec(text)?.[1];
    if (!value) {
      return null;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  public resolveRuleKey(
    chunk:
      | { sectionId?: string | null; headingPath?: string[] | null }
      | undefined,
    index: number,
  ): string {
    const sectionId = chunk?.sectionId?.trim();
    if (sectionId) return sectionId.slice(0, 128);
    const heading = (chunk?.headingPath ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .join(' > ');
    if (heading) return heading.slice(0, 128);
    return `chunk-${index}`;
  }

  public resolveChunkValidity(
    content: string,
    effectiveAt: Date | null,
    expiredAt: Date | null,
    validityMonths?: number,
  ): { effectiveAt: Date | null; expiredAt: Date | null } {
    const inlineStart = content.match(
      /(?:自|从)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:起|开始)/u,
    );
    const parsedStart = inlineStart
      ? this.parseDateOverride(inlineStart[1].replace(/\//g, '-'))
      : null;
    const start = effectiveAt ?? parsedStart;
    if (expiredAt) return { effectiveAt: start, expiredAt };
    const months = validityMonths ?? this.extractValidityMonths(content);
    if (months === null || months === undefined || months <= 0) {
      return { effectiveAt: start, expiredAt };
    }
    const from = start ?? new Date();
    const until = new Date(from);
    until.setMonth(until.getMonth() + months);
    return { effectiveAt: start ?? from, expiredAt: until };
  }

  public extractValidityMonths(content: string): number | null {
    const match = content.match(
      /(?:有效期(?:为)?|valid\s+for)\s*([0-9一二三四五六七八九十两]+)\s*(?:个)?\s*月/iu,
    );
    if (match === null) return null;
    const raw = match[1];
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric;
    const chinese: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
      十一: 11,
      十二: 12,
    };
    return chinese[raw] ?? null;
  }

  public parseDateOverride(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  public extractSourceAuthority(filename: string, content: string): string {
    const haystack = `${filename}\n${content}`.toLowerCase();
    if (/废止|失效|deprecated/.test(haystack)) return 'deprecated';
    if (/草稿|draft/.test(haystack)) return 'draft';
    if (/正式|官方|制度|policy|official/.test(haystack)) return 'official';
    return 'normal';
  }

  public mergeBusinessMetadata(
    detected: GameDocumentMetadata,
    explicit?: DocumentBusinessMetadata,
  ): ResolvedDocumentBusinessMetadata {
    return {
      projectId: explicit?.projectId?.trim() || detected.projectId,
      activityId: explicit?.activityId?.trim() || detected.activityId,
      region: explicit?.region?.trim() || detected.region,
      locale: explicit?.locale?.trim() || detected.locale,
      channel: explicit?.channel?.trim() || detected.channel,
      roleScope:
        explicit?.roleScope && explicit.roleScope.length > 0
          ? [
              ...new Set(
                explicit.roleScope.map((item) => item.trim()).filter(Boolean),
              ),
            ]
          : detected.roleScope,
      documentType: explicit?.documentType ?? detected.documentType,
      lifecycleStatus: this.applyApprovalGate(
        explicit?.lifecycleStatus ?? detected.lifecycleStatus,
      ),
      supersedesDocId:
        explicit?.supersedesDocId?.trim() || detected.supersedesDocId,
      docVersion: explicit?.docVersion?.trim() || null,
      effectiveAt: explicit?.effectiveAt?.trim() || null,
      expiredAt: explicit?.expiredAt?.trim() || null,
      changeType: explicit?.changeType,
      validityMonths: explicit?.validityMonths,
    };
  }

  public applyApprovalGate(
    lifecycleStatus: DocumentLifecycleStatus,
  ): DocumentLifecycleStatus {
    const raw = (process.env.DOCUMENT_REQUIRE_APPROVAL ?? '')
      .trim()
      .toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(raw)) return lifecycleStatus;
    return 'draft';
  }
}
