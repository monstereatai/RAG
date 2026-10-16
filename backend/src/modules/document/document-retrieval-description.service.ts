import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentRetrievalDescriptionChunkEntity } from '../../providers/db/entities/document-retrieval-description-chunk.entity';
import { DocumentRetrievalDescriptionEntity } from '../../providers/db/entities/document-retrieval-description.entity';
import { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';

const MAX_DESCRIPTION_BYTES = 8 * 1024;
const MAX_TABLE_ROWS = 20;

export interface DocumentRetrievalDescriptionDraft {
  tenantId: string;
  docId: string;
  userId?: string | null;
  docVersion?: string | null;
  indexGeneration?: string | null;
  descriptionType: string;
  content: string;
  sourceChunkIds: string[];
}

export interface DescriptionBuildDocument {
  tenantId?: string | null;
  docId: string;
  userId?: string | null;
  docVersion?: string | null;
  indexGeneration?: string | null;
  filename?: string | null;
  summary?: string | null;
}

export interface DescriptionBuildChunk {
  id: string;
  content: string;
  tableRef?: string | null;
  headingPath?: string[] | string | null;
}

export interface ReplaceDocumentRetrievalDescriptionsInput {
  tenantId: string;
  docId: string;
  userId?: string | null;
  docVersion?: string | null;
  indexGeneration?: string | null;
  descriptions: Array<
    Pick<DocumentRetrievalDescriptionDraft, 'descriptionType' | 'content'> & {
      sourceChunkIds?: string[];
    }
  >;
}

export interface SearchDocumentRetrievalDescriptionsOptions {
  tenantId: string;
  topK?: number;
}

export interface DocumentRetrievalDescriptionSearchHit {
  id: string;
  tenantId: string;
  docId: string;
  userId: string;
  descriptionType: string;
  indexGeneration: string | null;
  docVersion: string | null;
  content: string;
  sourceChunkIds: string[];
  score: number;
}

export interface RebuildDocumentRetrievalDescriptionsOptions {
  tenantId?: string;
  docId?: string;
}

export interface DocumentRetrievalDescriptionAudit {
  documentFound: boolean;
  docVersion: string | null;
  indexGeneration: string | null;
  lifecycleStatus: string | null;
  reviewStatus: string | null;
  effectiveAt: Date | null;
  expiredAt: Date | null;
  expectedCount: number;
  pgCount: number;
  milvusCount: number;
  missingCount: number;
  staleCount: number;
  missingPgCount: number;
  stalePgCount: number;
  missingMilvusCount: number;
  staleMilvusCount: number;
  contentMismatchCount: number;
  sourceMappingMismatchCount: number;
}

@Injectable()
export class DocumentRetrievalDescriptionService {
  constructor(
    @InjectRepository(DocumentRetrievalDescriptionEntity)
    private readonly descriptionRepo: Repository<DocumentRetrievalDescriptionEntity>,
    @InjectRepository(DocumentRetrievalDescriptionChunkEntity)
    private readonly sourceChunkRepo: Repository<DocumentRetrievalDescriptionChunkEntity>,
    @InjectRepository(DocumentMetaEntity)
    private readonly documentMetaRepo: Repository<DocumentMetaEntity>,
    @InjectRepository(DocumentChunkEntity)
    private readonly documentChunkRepo: Repository<DocumentChunkEntity>,
    private readonly embedding: EmbeddingProvider,
    private readonly vectorStore: VectorStoreProvider,
  ) {}

  /** 从已有元数据和原文块构造摘要、媒体描述和表格描述，不改写原始分块。 */
  buildDescriptions(
    document: DescriptionBuildDocument,
    chunks: DescriptionBuildChunk[],
  ): DocumentRetrievalDescriptionDraft[] {
    const tenantId = document.tenantId?.trim() || 'legacy';
    const shared = {
      tenantId,
      docId: document.docId,
      userId: document.userId ?? null,
      docVersion: document.docVersion ?? null,
      indexGeneration: document.indexGeneration ?? null,
    };
    const drafts: DocumentRetrievalDescriptionDraft[] = [];
    const sourceChunkIds = chunks.map((chunk) => chunk.id);
    const filename = document.filename?.trim() ?? '';
    const summary = document.summary?.trim();

    if (summary) {
      drafts.push({
        ...shared,
        descriptionType: 'document_summary',
        content: this.fitDescription(
          [filename ? `文档：${filename}` : '', summary]
            .filter(Boolean)
            .join('\n'),
        ),
        sourceChunkIds,
      });
    }

    const extension = filename.toLowerCase().split('.').pop() ?? '';
    const isVideo = ['mp4', 'mov', 'm4v', 'webm'].includes(extension);
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(
      extension,
    );
    for (const chunk of chunks) {
      const heading = this.headingText(chunk.headingPath);
      const mediaText = this.extractMediaText(chunk.content);
      const hasImageDescription = this.hasDescriptiveImageAlt(chunk.content);
      const hasVideoDescription =
        isVideo &&
        /(音频转写|画面要点|关键帧)/.test(`${heading}\n${chunk.content}`);
      const isMediaDescription =
        (hasVideoDescription && mediaText) ||
        ((isImage || hasImageDescription) && hasImageDescription && mediaText);
      if (!isMediaDescription) continue;
      drafts.push({
        ...shared,
        descriptionType: isVideo ? 'video_description' : 'image_description',
        content: this.fitDescription(
          [filename ? `媒体：${filename}` : '', heading, mediaText]
            .filter(Boolean)
            .join('\n'),
        ),
        sourceChunkIds: [chunk.id],
      });
    }

    const tableGroups = new Map<
      string,
      {
        tableRef: string;
        header: string;
        rows: string[];
        sourceChunkIds: Set<string>;
      }
    >();
    for (const chunk of chunks) {
      const tableRef = chunk.tableRef?.trim();
      if (!tableRef) continue;
      let currentHeader = '';
      for (const line of chunk.content.split(/\r?\n/)) {
        const headerMatch = line.match(/^\s*表格列：\s*(.+?)\s*$/);
        if (headerMatch) {
          currentHeader = headerMatch[1];
          continue;
        }
        const rowMatch = line.match(/^\s*表格行：\s*(.+?)\s*$/);
        if (!rowMatch) continue;

        const row = rowMatch[1];
        const header =
          currentHeader ||
          [...row.matchAll(/(?:^|；)\s*([^=；]+?)\s*=/g)]
            .map((match) => match[1].trim())
            .join(' / ');
        if (!header) continue;
        const key = `${tableRef}\0${header}`;
        const group = tableGroups.get(key) ?? {
          tableRef,
          header,
          rows: [],
          sourceChunkIds: new Set<string>(),
        };
        if (group.rows.length < MAX_TABLE_ROWS) {
          group.rows.push(row);
          group.sourceChunkIds.add(chunk.id);
        }
        tableGroups.set(key, group);
      }
    }
    for (const group of tableGroups.values()) {
      const text = this.fitDescription(
        [
          filename ? `文档：${filename}` : '',
          `表格：${group.tableRef}`,
          `表格列：${group.header}`,
          ...group.rows.map((row) => `表格行：${row}`),
        ]
          .filter(Boolean)
          .join('\n'),
      );
      if (!text) continue;
      drafts.push({
        ...shared,
        descriptionType: 'table_group',
        content: text,
        sourceChunkIds: [...group.sourceChunkIds],
      });
    }

    return drafts.filter((draft) => draft.content.length > 0);
  }

  async create(
    input: DocumentRetrievalDescriptionDraft,
  ): Promise<DocumentRetrievalDescriptionEntity> {
    const prepared = this.prepareDrafts([input])[0];
    const vector = await this.embedding.embedQuery(prepared.entity.content);
    await this.persistDescriptions([prepared]);
    await this.vectorStore.upsertDescriptions([
      this.toVectorRecord(prepared.entity, input.userId, vector),
    ]);
    return prepared.entity;
  }

  async replaceForDocument(
    input: ReplaceDocumentRetrievalDescriptionsInput,
  ): Promise<DocumentRetrievalDescriptionEntity[]> {
    const prepared = this.prepareDrafts(
      input.descriptions.map((description) => ({
        tenantId: input.tenantId,
        docId: input.docId,
        userId: input.userId,
        docVersion: input.docVersion,
        indexGeneration: input.indexGeneration,
        descriptionType: description.descriptionType,
        content: description.content,
        sourceChunkIds: description.sourceChunkIds ?? [],
      })),
    );
    const vectors = await this.embedPrepared(prepared);
    await this.persistDescriptions(prepared, {
      tenantId: input.tenantId,
      docId: input.docId,
    });
    await this.vectorStore.deleteDescriptionsByDocId(
      input.tenantId,
      input.docId,
    );
    await this.vectorStore.upsertDescriptions(vectors);
    return prepared.map(({ entity }) => entity);
  }

  /** 向量候选只按租户约束；调用方必须再按允许的 docId 做 ACL 复核。 */
  async searchByVector(
    vector: number[],
    options: SearchDocumentRetrievalDescriptionsOptions,
  ): Promise<DocumentRetrievalDescriptionSearchHit[]> {
    const tenantId = options.tenantId?.trim();
    if (!tenantId) throw new Error('searchByVector requires tenantId');
    const topK = Math.max(1, Math.min(options.topK ?? 10, 100));
    const vectorHits = await this.vectorStore.searchDescriptions(vector, {
      tenantId,
      topK,
    });
    if (vectorHits.length === 0) return [];

    const ids = [...new Set(vectorHits.map((hit) => hit.id))];
    const descriptions = await this.descriptionRepo.find({
      where: { id: In(ids), tenantId },
    });
    const byId = new Map(
      descriptions.map((description) => [description.id, description]),
    );
    const links = await this.sourceChunkRepo.find({
      where: { descriptionId: In(ids) },
    });
    const chunkIdsByDescription = new Map<string, string[]>();
    for (const link of links) {
      const idsForDescription =
        chunkIdsByDescription.get(link.descriptionId) ?? [];
      idsForDescription.push(link.sourceChunkId);
      chunkIdsByDescription.set(link.descriptionId, idsForDescription);
    }

    return vectorHits.flatMap((hit) => {
      const description = byId.get(hit.id);
      if (!description || description.docId !== hit.docId) return [];
      return [
        {
          id: description.id,
          tenantId: description.tenantId,
          docId: description.docId,
          userId: hit.userId,
          descriptionType: description.descriptionType,
          indexGeneration: description.indexGeneration,
          docVersion: description.docVersion,
          content: description.content,
          sourceChunkIds: chunkIdsByDescription.get(description.id) ?? [],
          score: hit.score,
        },
      ];
    });
  }

  async search(
    query: string,
    options: SearchDocumentRetrievalDescriptionsOptions,
  ): Promise<DocumentRetrievalDescriptionSearchHit[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const vector = await this.embedding.embedQuery(normalized);
    return this.searchByVector(vector, options);
  }

  /** 先清 Milvus，再删 PostgreSQL；向量删除失败时保留描述和原文。 */
  async deleteForDocument(input: {
    tenantId: string;
    docId: string;
  }): Promise<number> {
    await this.vectorStore.deleteDescriptionsByDocId(
      input.tenantId,
      input.docId,
    );
    const descriptions = await this.descriptionRepo.find({
      where: { tenantId: input.tenantId, docId: input.docId },
      select: { id: true },
    });
    const ids = descriptions.map((description) => description.id);
    await this.descriptionRepo.manager.transaction(async (manager) => {
      if (ids.length > 0) {
        await manager.delete(DocumentRetrievalDescriptionChunkEntity, {
          descriptionId: In(ids),
        });
      }
      await manager.delete(DocumentRetrievalDescriptionEntity, {
        tenantId: input.tenantId,
        docId: input.docId,
      });
    });
    return ids.length;
  }

  countForDocument(input: {
    tenantId: string;
    docId: string;
  }): Promise<number> {
    return this.descriptionRepo.count({
      where: { tenantId: input.tenantId, docId: input.docId },
    });
  }

  /** 对照当前元数据、原文、PostgreSQL 描述记录和 Milvus 向量 ID。 */
  async auditForDocument(input: {
    tenantId: string;
    docId: string;
  }): Promise<DocumentRetrievalDescriptionAudit> {
    const tenantId = this.normalizeTenantId(input.tenantId);
    const docId = input.docId.trim();
    if (!docId) throw new Error('auditForDocument requires docId');

    const metadataWhere: FindOptionsWhere<DocumentMetaEntity>[] =
      tenantId === 'legacy'
        ? [
            { docId, tenantId: 'legacy' },
            { docId, tenantId: IsNull() },
          ]
        : [{ docId, tenantId }];
    const chunkWhere: FindOptionsWhere<DocumentChunkEntity>[] =
      tenantId === 'legacy'
        ? [
            { docId, tenantId: 'legacy' },
            { docId, tenantId: IsNull() },
          ]
        : [{ docId, tenantId }];
    const [metadataRows, chunkRows, pgDescriptions] = await Promise.all([
      this.documentMetaRepo.find({ where: metadataWhere }),
      this.documentChunkRepo.find({ where: chunkWhere }),
      this.descriptionRepo.find({ where: { tenantId, docId } }),
    ]);
    const document = metadataRows.find(
      (row) => this.normalizeTenantId(row.tenantId) === tenantId,
    );
    const chunks = chunkRows.filter(
      (row) => this.normalizeTenantId(row.tenantId) === tenantId,
    );
    const expected = new Map(
      this.prepareDrafts(
        document ? this.buildDescriptions(document, chunks) : [],
      ).map(({ draft, entity }) => [entity.id, draft]),
    );

    const pgIds = new Set(pgDescriptions.map((row) => row.id));
    const pgById = new Map(pgDescriptions.map((row) => [row.id, row]));
    const links = pgDescriptions.length
      ? await this.sourceChunkRepo.find({
          where: {
            descriptionId: In(pgDescriptions.map((row) => row.id)),
          },
        })
      : [];
    const pgSourceIds = new Map<string, Set<string>>();
    for (const link of links) {
      const ids = pgSourceIds.get(link.descriptionId) ?? new Set<string>();
      ids.add(link.sourceChunkId);
      pgSourceIds.set(link.descriptionId, ids);
    }

    const milvusIds = new Set(
      await this.vectorStore.listDescriptionIds(tenantId, docId),
    );
    const expectedIds = new Set(expected.keys());
    const missingPgIds = [...expectedIds].filter((id) => !pgIds.has(id));
    const stalePgIds = [...pgIds].filter((id) => !expectedIds.has(id));
    const missingMilvusIds = [...expectedIds].filter(
      (id) => !milvusIds.has(id),
    );
    const staleMilvusIds = [...milvusIds].filter((id) => !expectedIds.has(id));
    const contentMismatchCount = [...expected].filter(([id, draft]) => {
      const stored = pgById.get(id);
      return (
        stored !== undefined &&
        stored.contentHash !== this.hashContent(draft.content)
      );
    }).length;
    const sourceMappingMismatchCount = [...expected].filter(
      ([id, draft]) =>
        !this.sameStringSet(
          pgSourceIds.get(id) ?? new Set<string>(),
          new Set(draft.sourceChunkIds),
        ),
    ).length;
    const missingIds = new Set([...missingPgIds, ...missingMilvusIds]);
    const staleIds = new Set([...stalePgIds, ...staleMilvusIds]);

    return {
      documentFound: Boolean(document),
      docVersion: document?.docVersion ?? null,
      indexGeneration: document?.indexGeneration ?? null,
      lifecycleStatus: document?.lifecycleStatus ?? null,
      reviewStatus: document?.reviewStatus ?? null,
      effectiveAt: document?.effectiveAt ?? null,
      expiredAt: document?.expiredAt ?? null,
      expectedCount: expected.size,
      pgCount: pgIds.size,
      milvusCount: milvusIds.size,
      missingCount: missingIds.size,
      staleCount: staleIds.size,
      missingPgCount: missingPgIds.length,
      stalePgCount: stalePgIds.length,
      missingMilvusCount: missingMilvusIds.length,
      staleMilvusCount: staleMilvusIds.length,
      contentMismatchCount,
      sourceMappingMismatchCount,
    };
  }

  /** 从 PostgreSQL 元数据和原文 chunks 重建描述行与专用 Milvus 集合。 */
  async rebuild(
    options: RebuildDocumentRetrievalDescriptionsOptions = {},
  ): Promise<{ documents: number; descriptions: number }> {
    const metaWhere: FindOptionsWhere<DocumentMetaEntity> = {};
    if (options.docId) metaWhere.docId = options.docId;
    const metadataWhere: FindOptionsWhere<DocumentMetaEntity>[] =
      options.tenantId === 'legacy'
        ? [
            { ...metaWhere, tenantId: 'legacy' },
            { ...metaWhere, tenantId: IsNull() },
          ]
        : options.tenantId
          ? [{ ...metaWhere, tenantId: options.tenantId }]
          : [metaWhere];
    const documents = await this.documentMetaRepo.find({
      where: metadataWhere,
    });

    const existingWhere: FindOptionsWhere<DocumentRetrievalDescriptionEntity> =
      {};
    if (options.tenantId) existingWhere.tenantId = options.tenantId;
    if (options.docId) existingWhere.docId = options.docId;
    const existingDescriptions = await this.descriptionRepo.find({
      where: existingWhere,
    });
    const documentByKey = new Map(
      documents.map((document) => [
        this.documentKey(document.tenantId, document.docId),
        document,
      ]),
    );
    const workKeys = new Set(documentByKey.keys());
    for (const description of existingDescriptions) {
      workKeys.add(this.documentKey(description.tenantId, description.docId));
    }
    if (options.docId && options.tenantId) {
      workKeys.add(this.documentKey(options.tenantId, options.docId));
    }

    const chunkWhere: FindOptionsWhere<DocumentChunkEntity>[] = [];
    for (const key of workKeys) {
      const [tenantId, docId] = key.split('\0');
      if (tenantId === 'legacy') {
        chunkWhere.push(
          { tenantId: 'legacy', docId },
          { tenantId: IsNull(), docId },
        );
      } else {
        chunkWhere.push({ tenantId, docId });
      }
    }
    const chunks = chunkWhere.length
      ? await this.documentChunkRepo.find({ where: chunkWhere })
      : [];
    const chunksByDocument = new Map<string, DocumentChunkEntity[]>();
    for (const chunk of chunks) {
      const key = this.documentKey(chunk.tenantId, chunk.docId);
      const group = chunksByDocument.get(key) ?? [];
      group.push(chunk);
      chunksByDocument.set(key, group);
    }

    let descriptionCount = 0;
    for (const key of workKeys) {
      const document = documentByKey.get(key);
      const [tenantId, docId] = key.split('\0');
      const drafts = document
        ? this.buildDescriptions(document, chunksByDocument.get(key) ?? [])
        : [];
      const audit = await this.auditForDocument({ tenantId, docId });
      if (
        audit.missingCount === 0 &&
        audit.staleCount === 0 &&
        audit.contentMismatchCount === 0 &&
        audit.sourceMappingMismatchCount === 0
      ) {
        continue;
      }

      const saved = await this.replaceForDocument({
        tenantId,
        docId,
        userId: document?.userId,
        docVersion: document?.docVersion,
        indexGeneration: document?.indexGeneration,
        descriptions: drafts.map(
          ({ descriptionType, content, sourceChunkIds }) => ({
            descriptionType,
            content,
            sourceChunkIds,
          }),
        ),
      });
      descriptionCount += saved.length;
    }

    return { documents: documents.length, descriptions: descriptionCount };
  }

  private prepareDrafts(drafts: DocumentRetrievalDescriptionDraft[]) {
    const merged = new Map<
      string,
      { draft: DocumentRetrievalDescriptionDraft; contentHash: string }
    >();
    for (const draft of drafts) {
      const tenantId = draft.tenantId.trim();
      const docId = draft.docId.trim();
      const content = draft.content.trim();
      if (!tenantId || !docId || !draft.descriptionType.trim() || !content) {
        throw new Error(
          'Retrieval description requires tenant, document, type and content',
        );
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_DESCRIPTION_BYTES) {
        throw new Error(
          `Retrieval description exceeds ${MAX_DESCRIPTION_BYTES} UTF-8 bytes`,
        );
      }
      const contentHash = createHash('sha256').update(content).digest('hex');
      const key = `${tenantId}\0${docId}\0${draft.docVersion ?? ''}\0${draft.indexGeneration ?? ''}\0${draft.descriptionType}\0${contentHash}`;
      const current = merged.get(key);
      if (current) {
        current.draft.sourceChunkIds = [
          ...new Set([
            ...current.draft.sourceChunkIds,
            ...draft.sourceChunkIds,
          ]),
        ];
      } else {
        merged.set(key, {
          draft: {
            ...draft,
            tenantId,
            docId,
            content,
            sourceChunkIds: [...new Set(draft.sourceChunkIds)],
          },
          contentHash,
        });
      }
    }

    return [...merged.values()].map(({ draft, contentHash }) => {
      const id = createHash('sha256')
        .update(
          [
            draft.tenantId,
            draft.docId,
            draft.docVersion ?? '',
            draft.indexGeneration ?? '',
            draft.descriptionType,
            contentHash,
          ].join('\0'),
        )
        .digest('hex');
      const entity = this.descriptionRepo.create({
        id,
        tenantId: draft.tenantId,
        docId: draft.docId,
        docVersion: draft.docVersion ?? null,
        indexGeneration: draft.indexGeneration ?? null,
        descriptionType: draft.descriptionType,
        content: draft.content,
        contentHash,
      });
      return { draft, entity };
    });
  }

  private async persistDescriptions(
    prepared: ReturnType<DocumentRetrievalDescriptionService['prepareDrafts']>,
    replace?: { tenantId: string; docId: string },
  ): Promise<void> {
    await this.descriptionRepo.manager.transaction(async (manager) => {
      const descriptions = manager.getRepository(
        DocumentRetrievalDescriptionEntity,
      );
      const links = manager.getRepository(
        DocumentRetrievalDescriptionChunkEntity,
      );
      if (replace) {
        const old = await descriptions.find({
          where: { tenantId: replace.tenantId, docId: replace.docId },
          select: { id: true },
        });
        const oldIds = old.map((description) => description.id);
        if (oldIds.length > 0) {
          await links.delete({ descriptionId: In(oldIds) });
        }
        await descriptions.delete({
          tenantId: replace.tenantId,
          docId: replace.docId,
        });
      } else {
        const ids = prepared.map(({ entity }) => entity.id);
        if (ids.length > 0) {
          await links.delete({ descriptionId: In(ids) });
        }
      }
      if (prepared.length === 0) return;
      await descriptions.save(prepared.map(({ entity }) => entity));
      const linkRows = prepared.flatMap(({ entity, draft }) =>
        draft.sourceChunkIds.map((sourceChunkId) => ({
          descriptionId: entity.id,
          sourceChunkId,
        })),
      );
      if (linkRows.length > 0) await links.insert(linkRows);
    });
  }

  private async embedPrepared(
    prepared: ReturnType<DocumentRetrievalDescriptionService['prepareDrafts']>,
  ) {
    if (prepared.length === 0) return [];

    const vectors = await this.embedding.embedDocuments(
      prepared.map(({ entity }) => entity.content),
    );
    return prepared.map(({ draft, entity }, index) =>
      this.toVectorRecord(entity, draft.userId, vectors[index]),
    );
  }

  private toVectorRecord(
    entity: DocumentRetrievalDescriptionEntity,
    userId: string | null | undefined,
    vector: number[],
  ) {
    return {
      id: entity.id,
      vector,
      docId: entity.docId,
      tenantId: entity.tenantId,
      userId,
      content: entity.content,
    };
  }

  private documentKey(
    tenantId: string | null | undefined,
    docId: string,
  ): string {
    return `${this.normalizeTenantId(tenantId)}\0${docId}`;
  }

  private normalizeTenantId(tenantId: string | null | undefined): string {
    return tenantId?.trim() || 'legacy';
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private sameStringSet(left: Set<string>, right: Set<string>): boolean {
    return (
      left.size === right.size && [...left].every((value) => right.has(value))
    );
  }

  private headingText(value: string[] | string | null | undefined): string {
    if (!value) return '';
    if (Array.isArray(value)) return value.filter(Boolean).join(' > ');
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).join(' > ') : value;
    } catch {
      return value;
    }
  }

  private extractMediaText(content: string): string {
    return content
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasDescriptiveImageAlt(content: string): boolean {
    return [...content.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)].some((match) => {
      const alt = match[1]?.trim() ?? '';
      return alt.length > 3 && !/^(image|frame|图片|图像)$/i.test(alt);
    });
  }

  private fitDescription(content: string): string {
    let result = '';
    for (const character of content.trim()) {
      if (
        Buffer.byteLength(result + character, 'utf8') > MAX_DESCRIPTION_BYTES
      ) {
        break;
      }
      result += character;
    }
    return result;
  }
}
