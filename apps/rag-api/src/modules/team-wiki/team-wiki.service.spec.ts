import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager, FindOneOptions, UpdateResult } from 'typeorm';
import { TeamWikiPageEntity } from '../../providers/db/entities/team-wiki-page.entity';
import { TeamWikiRevisionEntity } from '../../providers/db/entities/team-wiki-revision.entity';
import type { UploadOptions, UploadResult } from '../document/document.service';
import { TeamWikiService, type TeamWikiReference } from './team-wiki.service';

const makeRevision = (overrides: Partial<TeamWikiRevisionEntity> = {}) =>
  ({
    id: 'revision-1',
    tenantId: 'tenant-a',
    pageId: 'page-1',
    revisionNumber: 1,
    title: 'Wiki',
    content: 'old line\nstable line',
    referencesJson: '[]',
    changeSummary: null,
    createdBy: 'user-1',
    publishStatus: 'idle',
    publishedDocumentId: null,
    publishedLifecycleStatus: null,
    publishError: null,
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) satisfies TeamWikiRevisionEntity;

const makePage = (overrides: Partial<TeamWikiPageEntity> = {}) =>
  ({
    id: 'page-1',
    tenantId: 'tenant-a',
    title: 'Wiki',
    currentRevisionId: 'revision-1',
    lastPublishedRevisionId: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }) satisfies TeamWikiPageEntity;

const makeService = (dependencies: Record<string, unknown> = {}) => {
  const service = Object.create(TeamWikiService.prototype) as TeamWikiService;
  const defaults = {
    pageRepo: {},
    revisionRepo: {},
    documentMetaRepo: {},
    userRepo: {},
    documentService: {},
    documentPermissionService: {},
    ...dependencies,
  };
  for (const [key, value] of Object.entries(defaults)) {
    Object.defineProperty(service, key, { value, writable: true });
  }
  return service;
};

describe('TeamWikiService', () => {
  it('rejects source references outside the current tenant', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const service = makeService({ documentMetaRepo: { find } });
    const internals = service as unknown as {
      normalizeReferences: (
        tenantId: string,
        actorId: string,
        references: TeamWikiReference[],
      ) => Promise<TeamWikiReference[]>;
    };

    await expect(
      internals.normalizeReferences('tenant-a', 'user-1', [
        { docId: 'doc-other', label: 'Other tenant doc' },
      ]),
    ).rejects.toThrow(
      'references must point to documents in the current tenant',
    );
    expect(find).toHaveBeenCalledWith({
      select: ['docId'],
      where: [{ docId: 'doc-other', tenantId: 'tenant-a' }],
    });
  });

  it('rejects same-tenant source references the current actor cannot read', async () => {
    const find = jest.fn().mockResolvedValue([{ docId: 'doc-private' }]);
    const canRead = jest.fn().mockResolvedValue(false);
    const service = makeService({
      documentMetaRepo: { find },
      documentPermissionService: { canRead },
    });
    const internals = service as unknown as {
      normalizeReferences: (
        tenantId: string,
        actorId: string,
        references: TeamWikiReference[],
      ) => Promise<TeamWikiReference[]>;
    };

    await expect(
      internals.normalizeReferences('tenant-a', 'user-2', [
        { docId: 'doc-private', label: 'Private source' },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(canRead).toHaveBeenCalledWith(
      'doc-private',
      'user-2',
      [],
      'tenant-a',
    );
  });

  it('allows references the current actor can read within the same tenant', async () => {
    const find = jest.fn().mockResolvedValue([{ docId: 'doc-shared' }]);
    const canRead = jest.fn().mockResolvedValue(true);
    const service = makeService({
      documentMetaRepo: { find },
      documentPermissionService: { canRead },
    });
    const internals = service as unknown as {
      normalizeReferences: (
        tenantId: string,
        actorId: string,
        references: TeamWikiReference[],
      ) => Promise<TeamWikiReference[]>;
    };

    await expect(
      internals.normalizeReferences('tenant-a', 'user-2', [
        { docId: 'doc-shared', label: 'Shared source', quote: 'Approved text' },
      ]),
    ).resolves.toEqual([
      { docId: 'doc-shared', label: 'Shared source', quote: 'Approved text' },
    ]);

    expect(canRead).toHaveBeenCalledWith(
      'doc-shared',
      'user-2',
      [],
      'tenant-a',
    );
  });

  it('creates a new revision when rolling back without moving the history pointer backward', async () => {
    let currentRevisionId = 'revision-2';
    const page = makePage({ currentRevisionId });
    const revisions = [
      makeRevision({
        id: 'revision-1',
        revisionNumber: 1,
        content: 'original',
        title: 'Original',
      }),
      makeRevision({
        id: 'revision-2',
        revisionNumber: 2,
        content: 'changed',
        title: 'Changed',
      }),
    ];
    const repositories = new Map<unknown, unknown>();
    const manager = {
      getRepository: (entity: unknown) => repositories.get(entity),
    };
    const pageRepo = {
      findOne: jest.fn(() => Promise.resolve({ ...page, currentRevisionId })),
      update: jest.fn(
        (_where: unknown, update: Partial<TeamWikiPageEntity>) => {
          if (update.currentRevisionId) {
            currentRevisionId = update.currentRevisionId;
          }
          Object.assign(page, update);
          return Promise.resolve({ affected: 1 } as UpdateResult);
        },
      ),
      manager: {
        transaction: jest.fn(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(manager as unknown as EntityManager),
        ),
      },
    };
    const revisionRepo = {
      findOne: jest.fn((options: FindOneOptions<TeamWikiRevisionEntity>) => {
        const where = Array.isArray(options.where)
          ? options.where[0]
          : options.where;
        const revisionId = typeof where?.id === 'string' ? where.id : undefined;
        if (revisionId) {
          return Promise.resolve(
            revisions.find((revision) => revision.id === revisionId) ?? null,
          );
        }
        if (options.order?.revisionNumber) {
          return Promise.resolve(
            [...revisions].sort(
              (left, right) => right.revisionNumber - left.revisionNumber,
            )[0] ?? null,
          );
        }
        return Promise.resolve(null);
      }),
      create: jest.fn(
        (value: Partial<TeamWikiRevisionEntity>) =>
          value as TeamWikiRevisionEntity,
      ),
      save: jest.fn((revision: TeamWikiRevisionEntity) => {
        revisions.push(revision);
        return Promise.resolve(revision);
      }),
    };
    repositories.set(TeamWikiPageEntity, pageRepo);
    repositories.set(TeamWikiRevisionEntity, revisionRepo);
    const service = makeService({ pageRepo, revisionRepo });

    const result = await service.rollback(
      'tenant-a',
      'user-2',
      'page-1',
      'revision-1',
      2,
    );

    expect(revisions).toHaveLength(3);
    expect(revisions[2]).toMatchObject({
      revisionNumber: 3,
      title: 'Original',
      content: 'original',
      changeSummary: '回滚到版本 1',
      createdBy: 'user-2',
      publishStatus: 'idle',
    });
    expect(currentRevisionId).toBe(revisions[2].id);
    expect(result.revisionNumber).toBe(3);
    expect(pageRepo.manager.transaction).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('rejects an edit based on a stale revision number', async () => {
    const page = makePage();
    const repositories = new Map<unknown, unknown>();
    const manager = {
      getRepository: (entity: unknown) => repositories.get(entity),
    };
    const pageRepo = {
      manager: {
        transaction: jest.fn(
          (callback: (manager: EntityManager) => Promise<unknown>) =>
            callback(manager as unknown as EntityManager),
        ),
      },
    };
    const revisionRepo = {
      findOne: jest.fn().mockResolvedValue(makeRevision()),
    };
    repositories.set(TeamWikiPageEntity, pageRepo);
    repositories.set(TeamWikiRevisionEntity, revisionRepo);
    const pageFindOne = jest.fn().mockResolvedValue(page);
    Object.defineProperty(pageRepo, 'findOne', { value: pageFindOne });
    const service = makeService({ pageRepo, revisionRepo });

    await expect(
      service.update('tenant-a', 'user-1', 'page-1', {
        title: 'New title',
        expectedRevisionNumber: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('publishes the page through DocumentService with tenant-scoped source citations', async () => {
    const page = makePage();
    const revision = makeRevision({
      referencesJson: JSON.stringify([
        { docId: 'source-1', label: 'Design doc', quote: 'Approved flow' },
      ]),
    });
    const revisionUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const revisionFind = jest.fn().mockResolvedValue([]);
    const revisionRepo = {
      findOne: jest.fn().mockResolvedValue(revision),
      find: revisionFind,
      update: revisionUpdate,
    };
    const pageUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const pageRepo = {
      findOne: jest.fn().mockResolvedValue(page),
      update: pageUpdate,
    };
    const upload = jest
      .fn<Promise<UploadResult>, [string, string, string, UploadOptions]>()
      .mockResolvedValue({
        docId: 'rag-doc-1',
        chunkCount: 1,
        lifecycleStatus: 'effective',
      });
    const documentService = {
      upload,
      updateLifecycle: jest.fn(),
    };
    const setPermissions = jest.fn().mockResolvedValue(undefined);
    const documentPermissionService = {
      setPermissions,
      canRead: jest.fn().mockResolvedValue(true),
    };
    const service = makeService({
      pageRepo,
      revisionRepo,
      documentMetaRepo: {
        find: jest.fn().mockResolvedValue([{ docId: 'source-1' }]),
      },
      documentService,
      documentPermissionService,
    });

    await expect(
      service.publish('tenant-a', 'editor-2', 'page-1'),
    ).resolves.toEqual({
      pageId: 'page-1',
      revisionId: 'revision-1',
      documentId: 'rag-doc-1',
      lifecycleStatus: 'effective',
    });

    expect(upload.mock.calls[0]?.[0]).toBe('Wiki.md');
    expect(upload.mock.calls[0]?.[1]).toContain(
      '[Design doc](rag://documents/source-1)',
    );
    expect(upload.mock.calls[0]?.[2]).toBe('user-1');
    expect(upload.mock.calls[0]?.[3].tenantId).toBe('tenant-a');
    expect(upload.mock.calls[0]?.[3].businessMetadata).toMatchObject({
      lifecycleStatus: 'effective',
      docVersion: '1',
    });
    expect(setPermissions).toHaveBeenCalledWith('rag-doc-1', [
      { type: 'public', id: 'public' },
    ]);
    expect(documentPermissionService.canRead).toHaveBeenCalledWith(
      'source-1',
      'editor-2',
      [],
      'tenant-a',
    );
    expect(pageUpdate).toHaveBeenCalledWith(
      { id: 'page-1', tenantId: 'tenant-a' },
      { lastPublishedRevisionId: 'revision-1', updatedBy: 'editor-2' },
    );
  });

  it('rechecks source ACL before publishing an existing revision', async () => {
    const revision = makeRevision({
      referencesJson: JSON.stringify([
        { docId: 'source-1', label: 'Private source' },
      ]),
    });
    const upload = jest.fn();
    const service = makeService({
      pageRepo: { findOne: jest.fn().mockResolvedValue(makePage()) },
      revisionRepo: {
        findOne: jest.fn().mockResolvedValue(revision),
        update: jest.fn(),
      },
      documentMetaRepo: {
        find: jest.fn().mockResolvedValue([{ docId: 'source-1' }]),
      },
      documentService: { upload },
      documentPermissionService: {
        canRead: jest.fn().mockResolvedValue(false),
      },
    });

    await expect(
      service.publish('tenant-a', 'editor-2', 'page-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not delete a page when an existing published document cannot be archived', async () => {
    const softDelete = jest.fn();
    const updateLifecycle = jest.fn().mockResolvedValue(false);
    const service = makeService({
      pageRepo: {
        findOne: jest.fn().mockResolvedValue(makePage()),
        softDelete,
      },
      revisionRepo: {
        find: jest
          .fn()
          .mockResolvedValue([
            makeRevision({ publishedDocumentId: 'published-doc' }),
          ]),
      },
      documentService: { updateLifecycle },
    });

    await expect(
      service.delete('tenant-a', 'editor-2', 'page-1'),
    ).rejects.toThrow('published team wiki document could not be archived');
    expect(updateLifecycle).toHaveBeenCalledWith(
      'published-doc',
      'user-1',
      'archived',
    );
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('does not report a replacement publish as complete when an old document cannot retire', async () => {
    const revision = makeRevision();
    const revisionUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const service = makeService({
      pageRepo: {
        findOne: jest.fn().mockResolvedValue(makePage()),
        update: jest.fn(),
      },
      revisionRepo: {
        findOne: jest.fn().mockResolvedValue(revision),
        find: jest.fn().mockResolvedValue([
          makeRevision({
            id: 'old-revision',
            publishedDocumentId: 'old-doc',
          }),
        ]),
        update: revisionUpdate,
      },
      documentService: {
        upload: jest.fn().mockResolvedValue({
          docId: 'new-doc',
          lifecycleStatus: 'effective',
        }),
        updateLifecycle: jest.fn().mockResolvedValue(false),
      },
      documentPermissionService: {
        setPermissions: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      service.publish('tenant-a', 'editor-2', 'page-1'),
    ).rejects.toThrow('previous team wiki document could not be retired');
    expect(revisionUpdate).toHaveBeenLastCalledWith(
      { id: 'revision-1', tenantId: 'tenant-a', publishStatus: 'publishing' },
      expect.objectContaining({ publishStatus: 'failed' }),
    );
  });

  it('shows the current document lifecycle after a reviewed wiki revision is promoted', async () => {
    const revision = makeRevision({
      publishStatus: 'published',
      publishedDocumentId: 'wiki-doc',
      publishedLifecycleStatus: 'draft',
    });
    const service = makeService({
      pageRepo: {
        findOne: jest
          .fn()
          .mockResolvedValue(
            makePage({ lastPublishedRevisionId: 'revision-1' }),
          ),
      },
      revisionRepo: { findOne: jest.fn().mockResolvedValue(revision) },
      documentMetaRepo: {
        find: jest
          .fn()
          .mockResolvedValue([
            { docId: 'wiki-doc', lifecycleStatus: 'effective' },
          ]),
      },
    });

    await expect(service.get('tenant-a', 'page-1')).resolves.toMatchObject({
      status: 'published',
      publishedLifecycleStatus: 'effective',
    });
  });

  it('returns a line diff that identifies added, removed and unchanged lines', async () => {
    const pageRepo = {
      findOne: jest.fn().mockResolvedValue(makePage()),
    };
    const revisionRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(makeRevision({ content: 'keep\nremove' }))
        .mockResolvedValueOnce(makeRevision({ content: 'keep\nadd' })),
    };
    const service = makeService({ pageRepo, revisionRepo });

    await expect(
      service.compareRevisions(
        'tenant-a',
        'page-1',
        'revision-1',
        'revision-2',
      ),
    ).resolves.toMatchObject({
      changes: [
        { type: 'unchanged', value: 'keep' },
        { type: 'removed', value: 'remove' },
        { type: 'added', value: 'add' },
      ],
    });
  });
});
