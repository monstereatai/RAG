import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { TeamWikiPageEntity } from '../../providers/db/entities/team-wiki-page.entity';
import { TeamWikiRevisionEntity } from '../../providers/db/entities/team-wiki-revision.entity';
import { DocumentPermissionService } from '../document/document-permission.service';
import { DocumentService, UploadResult } from '../document/document.service';

export interface TeamWikiReference {
  docId: string;
  label: string;
  quote?: string;
}

export interface TeamWikiPageInput {
  title?: string;
  content?: string;
  references?: TeamWikiReference[];
  changeSummary?: string;
  expectedRevisionNumber?: number;
}

const MAX_TITLE_LENGTH = 256;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_REFERENCES = 50;

@Injectable()
export class TeamWikiService {
  constructor(
    @InjectRepository(TeamWikiPageEntity)
    private readonly pageRepo: Repository<TeamWikiPageEntity>,
    @InjectRepository(TeamWikiRevisionEntity)
    private readonly revisionRepo: Repository<TeamWikiRevisionEntity>,
    @InjectRepository(DocumentMetaEntity)
    private readonly documentMetaRepo: Repository<DocumentMetaEntity>,
    private readonly documentService: DocumentService,
    private readonly documentPermissionService: DocumentPermissionService,
  ) {}

  /** The ServiceTokenGuard-protected Admin bridge supplies a mapped Admin identity. */
  async resolveTenant(userId: string): Promise<string> {
    if (!/^admin:[a-f0-9]{58}$/.test(userId?.trim() ?? '')) {
      throw new ForbiddenException('mapped Admin principal is required');
    }
    const tenantId = process.env.RAG_ADMIN_TENANT_ID?.trim();
    if (!tenantId) {
      throw new ForbiddenException('RAG_ADMIN_TENANT_ID must be configured');
    }
    return tenantId;
  }

  async list(tenantId: string, query?: string, limit = 100) {
    const normalizedTenant = this.requireTenant(tenantId);
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 100));
    const builder = this.pageRepo
      .createQueryBuilder('page')
      .leftJoin(
        TeamWikiRevisionEntity,
        'revision',
        'revision.id = page.currentRevisionId AND revision.tenantId = page.tenantId',
      )
      .where('page.tenantId = :tenantId', { tenantId: normalizedTenant })
      .andWhere('page.deletedAt IS NULL');
    if (query?.trim()) {
      builder.andWhere(
        '(LOWER(page.title) LIKE :query OR LOWER(revision.content) LIKE :query)',
        { query: `%${this.escapeLike(query.trim().toLowerCase())}%` },
      );
    }
    const pages = await builder
      .orderBy('page.updatedAt', 'DESC')
      .take(safeLimit)
      .getMany();
    if (pages.length === 0) return [];
    const revisions = await this.revisionRepo.find({
      where: {
        tenantId: normalizedTenant,
        id: In(
          pages
            .map((page) => page.currentRevisionId)
            .filter((id): id is string => Boolean(id)),
        ),
      },
    });
    const revisionById = new Map(
      revisions.map((revision) => [revision.id, revision]),
    );
    const lifecycleByDocId = await this.publishedLifecycleMap(
      normalizedTenant,
      revisions,
    );
    return pages.map((page) =>
      this.toPageSummary(
        page,
        revisionById.get(page.currentRevisionId ?? ''),
        lifecycleByDocId,
      ),
    );
  }

  async get(tenantId: string, pageId: string) {
    const page = await this.requirePage(tenantId, pageId);
    const revision = page.currentRevisionId
      ? await this.revisionRepo.findOne({
          where: {
            id: page.currentRevisionId,
            pageId,
            tenantId: page.tenantId,
          },
        })
      : null;
    if (!revision)
      throw new NotFoundException('team wiki page revision not found');
    const lifecycleByDocId = await this.publishedLifecycleMap(page.tenantId, [
      revision,
    ]);
    return this.toPage(page, revision, lifecycleByDocId);
  }

  async create(
    tenantId: string,
    actorId: string,
    input: TeamWikiPageInput,
    trustedAdminPrincipal = false,
  ) {
    const tenant = this.requireTenant(tenantId);
    const title = this.requireTitle(input.title);
    const content = this.requireContent(input.content);
    const references = await this.normalizeReferences(
      tenant,
      actorId,
      input.references ?? [],
      trustedAdminPrincipal,
    );
    const pageId = randomUUID();
    const revisionId = randomUUID();

    await this.pageRepo.manager.transaction(async (manager) => {
      const pageRepo = manager.getRepository(TeamWikiPageEntity);
      const revisionRepo = manager.getRepository(TeamWikiRevisionEntity);
      const page = pageRepo.create({
        id: pageId,
        tenantId: tenant,
        title,
        currentRevisionId: null,
        lastPublishedRevisionId: null,
        createdBy: actorId,
        updatedBy: actorId,
      });
      await pageRepo.save(page);
      await revisionRepo.save(
        revisionRepo.create({
          id: revisionId,
          tenantId: tenant,
          pageId,
          revisionNumber: 1,
          title,
          content,
          referencesJson: JSON.stringify(references),
          changeSummary: input.changeSummary?.trim() || '创建页面',
          createdBy: actorId,
          publishStatus: 'idle',
        }),
      );
      await pageRepo.update(
        { id: pageId, tenantId: tenant },
        { currentRevisionId: revisionId },
      );
    });
    return this.get(tenant, pageId);
  }

  async update(
    tenantId: string,
    actorId: string,
    pageId: string,
    input: TeamWikiPageInput,
    trustedAdminPrincipal = false,
  ) {
    const tenant = this.requireTenant(tenantId);
    const references = input.references
      ? await this.normalizeReferences(
          tenant,
          actorId,
          input.references,
          trustedAdminPrincipal,
        )
      : undefined;
    const revisionId = randomUUID();

    await this.pageRepo.manager.transaction(async (manager) => {
      const pageRepo = manager.getRepository(TeamWikiPageEntity);
      const revisionRepo = manager.getRepository(TeamWikiRevisionEntity);
      const page = await pageRepo.findOne({
        where: { id: pageId, tenantId: tenant },
        lock: { mode: 'pessimistic_write' },
      });
      if (!page || page.deletedAt)
        throw new NotFoundException('team wiki page not found');
      const current = page.currentRevisionId
        ? await revisionRepo.findOne({
            where: { id: page.currentRevisionId, pageId, tenantId: tenant },
          })
        : null;
      if (!current)
        throw new NotFoundException('team wiki page revision not found');
      this.assertExpectedRevision(
        input.expectedRevisionNumber,
        current.revisionNumber,
      );

      const title = this.requireTitle(input.title ?? current.title);
      const content = this.requireContent(input.content ?? current.content);
      const nextReferences =
        references ?? this.parseReferences(current.referencesJson);
      if (
        title === current.title &&
        content === current.content &&
        JSON.stringify(nextReferences) ===
          JSON.stringify(this.parseReferences(current.referencesJson))
      ) {
        throw new BadRequestException('team wiki page has no changes');
      }

      const latest = await revisionRepo.findOne({
        where: { pageId, tenantId: tenant },
        order: { revisionNumber: 'DESC' },
      });
      const next = revisionRepo.create({
        id: revisionId,
        tenantId: tenant,
        pageId,
        revisionNumber: (latest?.revisionNumber ?? current.revisionNumber) + 1,
        title,
        content,
        referencesJson: JSON.stringify(nextReferences),
        changeSummary: input.changeSummary?.trim() || null,
        createdBy: actorId,
        publishStatus: 'idle',
      });
      await revisionRepo.save(next);
      await pageRepo.update(
        { id: pageId, tenantId: tenant },
        { title, currentRevisionId: revisionId, updatedBy: actorId },
      );
    });
    return this.get(tenant, pageId);
  }

  async delete(tenantId: string, actorId: string, pageId: string) {
    const tenant = this.requireTenant(tenantId);
    const page = await this.requirePage(tenant, pageId);
    const revisions = await this.revisionRepo.find({
      where: { tenantId: tenant, pageId },
      order: { revisionNumber: 'DESC' },
    });
    for (const revision of revisions) {
      if (!revision.publishedDocumentId) continue;
      const archived = await this.documentService.updateLifecycle(
        revision.publishedDocumentId,
        page.createdBy,
        'archived',
      );
      if (!archived) {
        throw new NotFoundException(
          'published team wiki document could not be archived',
        );
      }
    }
    await this.pageRepo.update(
      { id: pageId, tenantId: tenant },
      { updatedBy: actorId },
    );
    await this.pageRepo.softDelete({ id: pageId, tenantId: tenant });
    return { id: pageId, deleted: true };
  }

  async listRevisions(tenantId: string, pageId: string) {
    const page = await this.requirePage(tenantId, pageId);
    const revisions = await this.revisionRepo.find({
      where: { tenantId: page.tenantId, pageId },
      order: { revisionNumber: 'DESC' },
    });
    const lifecycleByDocId = await this.publishedLifecycleMap(
      page.tenantId,
      revisions,
    );
    return revisions.map((revision) =>
      this.toRevision(revision, lifecycleByDocId),
    );
  }

  async compareRevisions(
    tenantId: string,
    pageId: string,
    fromRevisionId: string,
    toRevisionId: string,
  ) {
    const page = await this.requirePage(tenantId, pageId);
    const [from, to] = await Promise.all([
      this.revisionRepo.findOne({
        where: { id: fromRevisionId, pageId, tenantId: page.tenantId },
      }),
      this.revisionRepo.findOne({
        where: { id: toRevisionId, pageId, tenantId: page.tenantId },
      }),
    ]);
    if (!from || !to)
      throw new NotFoundException('team wiki revision not found');
    const lifecycleByDocId = await this.publishedLifecycleMap(page.tenantId, [
      from,
      to,
    ]);
    return {
      from: this.toRevision(from, lifecycleByDocId),
      to: this.toRevision(to, lifecycleByDocId),
      changes: this.diffLines(from.content, to.content),
    };
  }

  async rollback(
    tenantId: string,
    actorId: string,
    pageId: string,
    targetRevisionId: string,
    expectedRevisionNumber?: number,
  ) {
    const tenant = this.requireTenant(tenantId);
    const revisionId = randomUUID();
    await this.pageRepo.manager.transaction(async (manager) => {
      const pageRepo = manager.getRepository(TeamWikiPageEntity);
      const revisionRepo = manager.getRepository(TeamWikiRevisionEntity);
      const page = await pageRepo.findOne({
        where: { id: pageId, tenantId: tenant },
        lock: { mode: 'pessimistic_write' },
      });
      if (!page || page.deletedAt)
        throw new NotFoundException('team wiki page not found');
      const target = await revisionRepo.findOne({
        where: { id: targetRevisionId, pageId, tenantId: tenant },
      });
      const current = page.currentRevisionId
        ? await revisionRepo.findOne({
            where: { id: page.currentRevisionId, pageId, tenantId: tenant },
          })
        : null;
      if (!target || !current)
        throw new NotFoundException('team wiki revision not found');
      this.assertExpectedRevision(
        expectedRevisionNumber,
        current.revisionNumber,
      );
      const latest = await revisionRepo.findOne({
        where: { pageId, tenantId: tenant },
        order: { revisionNumber: 'DESC' },
      });
      const nextNumber = (latest?.revisionNumber ?? current.revisionNumber) + 1;
      await revisionRepo.save(
        revisionRepo.create({
          id: revisionId,
          tenantId: tenant,
          pageId,
          revisionNumber: nextNumber,
          title: target.title,
          content: target.content,
          referencesJson: target.referencesJson,
          changeSummary: `回滚到版本 ${target.revisionNumber}`,
          createdBy: actorId,
          publishStatus: 'idle',
        }),
      );
      await pageRepo.update(
        { id: pageId, tenantId: tenant },
        {
          title: target.title,
          currentRevisionId: revisionId,
          updatedBy: actorId,
        },
      );
    });
    return this.get(tenant, pageId);
  }

  async publish(
    tenantId: string,
    actorId: string,
    pageId: string,
    trustedAdminPrincipal = false,
  ): Promise<{
    pageId: string;
    revisionId: string;
    documentId: string;
    lifecycleStatus: string;
    idempotent?: boolean;
  }> {
    const tenant = this.requireTenant(tenantId);
    const page = await this.requirePage(tenant, pageId);
    const revision = page.currentRevisionId
      ? await this.revisionRepo.findOne({
          where: { id: page.currentRevisionId, pageId, tenantId: tenant },
        })
      : null;
    if (!revision)
      throw new NotFoundException('team wiki page revision not found');
    await this.normalizeReferences(
      tenant,
      actorId,
      this.parseReferences(revision.referencesJson),
      trustedAdminPrincipal,
    );
    if (
      revision.publishStatus === 'published' &&
      revision.publishedDocumentId
    ) {
      const lifecycleByDocId = await this.publishedLifecycleMap(tenant, [
        revision,
      ]);
      return {
        pageId,
        revisionId: revision.id,
        documentId: revision.publishedDocumentId,
        lifecycleStatus:
          lifecycleByDocId.get(revision.publishedDocumentId) ??
          revision.publishedLifecycleStatus ??
          'unknown',
        idempotent: true,
      };
    }
    if (revision.publishStatus === 'publishing') {
      throw new ConflictException('team wiki revision is already publishing');
    }

    const claim = await this.revisionRepo.update(
      {
        id: revision.id,
        tenantId: tenant,
        publishStatus: revision.publishStatus,
      },
      { publishStatus: 'publishing', publishError: null },
    );
    if (!claim.affected)
      throw new ConflictException('team wiki revision publish state changed');

    try {
      let upload: UploadResult | undefined;
      let documentId = revision.publishedDocumentId;
      let lifecycleStatus = revision.publishedLifecycleStatus ?? 'draft';
      if (!documentId) {
        const previousPublished = await this.revisionRepo.find({
          where: { tenantId: tenant, pageId },
          order: { revisionNumber: 'DESC' },
        });
        const previousDocumentIds = previousPublished
          .filter((item) => Boolean(item.publishedDocumentId))
          .map((item) => item.publishedDocumentId as string);
        upload = await this.documentService.upload(
          `${this.safeFilename(revision.title)}.md`,
          this.renderPublishedContent(revision),
          page.createdBy,
          {
            tenantId: tenant,
            trustedAdminPrincipal,
            businessMetadata: {
              lifecycleStatus: 'effective',
              documentType: 'general',
              docVersion: String(revision.revisionNumber),
              supersedesDocId: previousDocumentIds[0] ?? null,
              effectiveAt: new Date().toISOString(),
            },
          },
        );
        documentId = upload.docId;
        lifecycleStatus = upload.lifecycleStatus ?? 'draft';
        await this.revisionRepo.update(
          { id: revision.id, tenantId: tenant, publishStatus: 'publishing' },
          {
            publishedDocumentId: documentId,
            publishedLifecycleStatus: lifecycleStatus,
            publishError: null,
          },
        );
      }
      if (!documentId)
        throw new Error('RAG document publish returned no document ID');

      await this.documentPermissionService.setPermissions(documentId, [
        { type: 'public', id: 'public' },
      ]);

      if (lifecycleStatus === 'effective') {
        const previousPublished = await this.revisionRepo.find({
          where: { tenantId: tenant, pageId },
          order: { revisionNumber: 'DESC' },
        });
        for (const oldRevision of previousPublished) {
          if (
            !oldRevision.publishedDocumentId ||
            oldRevision.publishedDocumentId === documentId
          )
            continue;
          const retired = await this.documentService.updateLifecycle(
            oldRevision.publishedDocumentId,
            page.createdBy,
            'deprecated',
          );
          if (!retired) {
            throw new NotFoundException(
              'previous team wiki document could not be retired',
            );
          }
        }
      }

      const now = new Date();
      await this.revisionRepo.update(
        { id: revision.id, tenantId: tenant, publishStatus: 'publishing' },
        {
          publishStatus: 'published',
          publishedDocumentId: documentId,
          publishedLifecycleStatus: lifecycleStatus,
          publishError: null,
          publishedAt: now,
        },
      );
      await this.pageRepo.update(
        { id: pageId, tenantId: tenant },
        { lastPublishedRevisionId: revision.id, updatedBy: actorId },
      );
      return { pageId, revisionId: revision.id, documentId, lifecycleStatus };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'team wiki publish failed';
      await this.revisionRepo.update(
        { id: revision.id, tenantId: tenant, publishStatus: 'publishing' },
        { publishStatus: 'failed', publishError: message.slice(0, 4000) },
      );
      throw error;
    }
  }

  private async requirePage(tenantId: string, pageId: string) {
    const page = await this.pageRepo.findOne({
      where: { id: pageId, tenantId: this.requireTenant(tenantId) },
    });
    if (!page || page.deletedAt)
      throw new NotFoundException('team wiki page not found');
    return page;
  }

  private async normalizeReferences(
    tenantId: string,
    actorId: string,
    references: TeamWikiReference[],
    trustedAdminPrincipal = false,
  ) {
    if (!Array.isArray(references) || references.length > MAX_REFERENCES) {
      throw new BadRequestException(
        `references must contain at most ${MAX_REFERENCES} items`,
      );
    }
    const normalized = references.map((reference) => {
      const docId = String(reference?.docId ?? '').trim();
      const label = String(reference?.label ?? '').trim();
      const quote = String(reference?.quote ?? '').trim();
      if (!docId || !label || label.length > 256 || quote.length > 2000) {
        throw new BadRequestException(
          'each reference requires a document ID and a label of at most 256 characters',
        );
      }
      return { docId, label, ...(quote ? { quote } : {}) };
    });
    const docIds = [...new Set(normalized.map((reference) => reference.docId))];
    if (docIds.length === 0) return normalized;
    const documents = await this.documentMetaRepo.find({
      select: ['docId'],
      where: docIds.map((docId) => ({ docId, tenantId })),
    });
    const found = new Set(documents.map((document) => document.docId));
    if (docIds.some((docId) => !found.has(docId))) {
      throw new BadRequestException(
        'references must point to documents in the current tenant',
      );
    }
    const readable = await Promise.all(
      docIds.map((docId) =>
        this.documentPermissionService.canRead(
          docId,
          actorId,
          trustedAdminPrincipal ? ['admin'] : [],
          tenantId,
          trustedAdminPrincipal,
        ),
      ),
    );
    if (readable.some((canRead) => !canRead)) {
      throw new ForbiddenException(
        'references must point to documents readable by the current user',
      );
    }
    return normalized;
  }

  private toPageSummary(
    page: TeamWikiPageEntity,
    revision?: TeamWikiRevisionEntity,
    lifecycleByDocId: Map<string, string> = new Map(),
  ) {
    const publishedLifecycleStatus = revision?.publishedDocumentId
      ? (lifecycleByDocId.get(revision.publishedDocumentId) ??
        revision.publishedLifecycleStatus)
      : revision?.publishedLifecycleStatus;
    return {
      id: page.id,
      title: revision?.title ?? page.title,
      excerpt: revision?.content.slice(0, 240) ?? '',
      revisionNumber: revision?.revisionNumber ?? 0,
      status:
        page.currentRevisionId &&
        page.currentRevisionId === page.lastPublishedRevisionId &&
        revision?.publishStatus === 'published'
          ? publishedLifecycleStatus === 'effective'
            ? 'published'
            : 'pending_review'
          : 'draft',
      publishStatus: revision?.publishStatus ?? 'idle',
      publishedDocumentId: revision?.publishedDocumentId ?? null,
      publishedLifecycleStatus: publishedLifecycleStatus ?? null,
      createdBy: page.createdBy,
      updatedBy: page.updatedBy,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  private toPage(
    page: TeamWikiPageEntity,
    revision: TeamWikiRevisionEntity,
    lifecycleByDocId: Map<string, string> = new Map(),
  ) {
    return {
      ...this.toPageSummary(page, revision, lifecycleByDocId),
      content: revision.content,
      references: this.parseReferences(revision.referencesJson),
      changeSummary: revision.changeSummary,
      lastPublishedRevisionId: page.lastPublishedRevisionId,
      revisionId: revision.id,
      publishError: revision.publishError,
    };
  }

  private toRevision(
    revision: TeamWikiRevisionEntity,
    lifecycleByDocId: Map<string, string> = new Map(),
  ) {
    return {
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      title: revision.title,
      content: revision.content,
      references: this.parseReferences(revision.referencesJson),
      changeSummary: revision.changeSummary,
      createdBy: revision.createdBy,
      createdAt: revision.createdAt.toISOString(),
      publishStatus: revision.publishStatus,
      publishedDocumentId: revision.publishedDocumentId,
      publishedLifecycleStatus: revision.publishedDocumentId
        ? (lifecycleByDocId.get(revision.publishedDocumentId) ??
          revision.publishedLifecycleStatus)
        : revision.publishedLifecycleStatus,
      publishError: revision.publishError,
      publishedAt: revision.publishedAt?.toISOString() ?? null,
    };
  }

  private async publishedLifecycleMap(
    tenantId: string,
    revisions: TeamWikiRevisionEntity[],
  ): Promise<Map<string, string>> {
    const docIds = [
      ...new Set(
        revisions
          .map((revision) => revision.publishedDocumentId)
          .filter((docId): docId is string => Boolean(docId)),
      ),
    ];
    if (docIds.length === 0) return new Map();
    const documents = await this.documentMetaRepo.find({
      select: ['docId', 'lifecycleStatus'],
      where: { tenantId, docId: In(docIds) },
    });
    return new Map(
      documents.map((document) => [document.docId, document.lifecycleStatus]),
    );
  }

  private parseReferences(value: string): TeamWikiReference[] {
    try {
      const parsed: unknown = JSON.parse(value || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is TeamWikiReference => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return false;
        }
        const reference = item as Record<string, unknown>;
        return (
          typeof reference.docId === 'string' &&
          typeof reference.label === 'string'
        );
      });
    } catch {
      return [];
    }
  }

  private renderPublishedContent(revision: TeamWikiRevisionEntity): string {
    const references = this.parseReferences(revision.referencesJson);
    if (references.length === 0) return revision.content;
    const citations = references
      .map((reference, index) => {
        const label = reference.label.replace(/[\x5B\x5D<>\r\n]/g, ' ').trim();
        const quote = reference.quote
          ? `\n  > ${reference.quote.replace(/[\r\n]+/g, ' ')}`
          : '';
        return `${index + 1}. [${label}](rag://documents/${encodeURIComponent(reference.docId)})${quote}`;
      })
      .join('\n');
    return `${revision.content.trim()}\n\n## 参考资料\n\n${citations}`;
  }

  private diffLines(fromContent: string, toContent: string) {
    const fromLines = fromContent.split('\n');
    const toLines = toContent.split('\n');
    if (fromLines.length * toLines.length > 1_000_000) {
      return [
        ...fromLines.map((value) => ({ type: 'removed' as const, value })),
        ...toLines.map((value) => ({ type: 'added' as const, value })),
      ];
    }
    const width = toLines.length + 1;
    const lcs = new Uint32Array((fromLines.length + 1) * width);
    for (let i = fromLines.length - 1; i >= 0; i -= 1) {
      for (let j = toLines.length - 1; j >= 0; j -= 1) {
        const offset = i * width + j;
        lcs[offset] =
          fromLines[i] === toLines[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    const changes: Array<{
      type: 'added' | 'removed' | 'unchanged';
      value: string;
    }> = [];
    let i = 0;
    let j = 0;
    while (i < fromLines.length && j < toLines.length) {
      if (fromLines[i] === toLines[j]) {
        changes.push({ type: 'unchanged', value: fromLines[i] });
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        changes.push({ type: 'removed', value: fromLines[i++] });
      } else {
        changes.push({ type: 'added', value: toLines[j++] });
      }
    }
    while (i < fromLines.length)
      changes.push({ type: 'removed', value: fromLines[i++] });
    while (j < toLines.length)
      changes.push({ type: 'added', value: toLines[j++] });
    return changes;
  }

  private requireTenant(tenantId: string) {
    const tenant = tenantId?.trim();
    if (!tenant) throw new BadRequestException('tenant context is required');
    return tenant;
  }

  private requireTitle(value?: string) {
    const title = value?.trim();
    if (!title || title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `title must contain 1-${MAX_TITLE_LENGTH} characters`,
      );
    }
    return title;
  }

  private requireContent(value?: string) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > MAX_CONTENT_LENGTH
    ) {
      throw new BadRequestException(
        `content must contain 1-${MAX_CONTENT_LENGTH} characters`,
      );
    }
    return value;
  }

  private assertExpectedRevision(
    expected: number | undefined,
    current: number,
  ) {
    if (expected !== undefined && expected !== current) {
      throw new ConflictException(
        'team wiki page changed; reload the latest revision before saving',
      );
    }
  }

  private escapeLike(value: string) {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  private safeFilename(title: string) {
    return title.replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 200) || 'wiki-page';
  }
}
