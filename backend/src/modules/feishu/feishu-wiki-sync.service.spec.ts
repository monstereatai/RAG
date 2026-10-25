import type { Repository } from 'typeorm';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import {
  FeishuWikiConnectorEntity,
  FeishuWikiItemEntity,
} from '../../providers/db/entities/feishu-wiki-connector.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { DocumentService } from '../document/document.service';
import { DocumentPermissionService } from '../document/document-permission.service';
import { FeishuWikiApiClient } from './feishu-wiki-api.client';
import { FeishuWikiSyncService } from './feishu-wiki-sync.service';

describe('FeishuWikiSyncService', () => {
  const originalAllowedTenants = process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS;

  beforeEach(() => {
    process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS = 'tenant-1';
  });

  afterAll(() => {
    if (originalAllowedTenants === undefined) {
      delete process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS;
    } else {
      process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS = originalAllowedTenants;
    }
  });

  it('indexes changes, keeps unchanged pages idempotent, and deactivates removed nodes after a full crawl', async () => {
    const connectors = new Map<string, FeishuWikiConnectorEntity>();
    const items = new Map<string, FeishuWikiItemEntity>();
    const connectorRepo = {
      findOne: jest.fn(
        ({ where }: { where: { tenantId: string; spaceId: string } }) =>
          [...connectors.values()].find(
            (item) =>
              item.tenantId === where.tenantId &&
              item.spaceId === where.spaceId,
          ) ?? null,
      ),
      create: jest.fn(
        (value: Partial<FeishuWikiConnectorEntity>) =>
          value as FeishuWikiConnectorEntity,
      ),
      save: jest.fn((item: FeishuWikiConnectorEntity) => {
        const saved = { ...item, updatedAt: new Date() };
        connectors.set(saved.id, saved);
        return saved;
      }),
      update: jest.fn(
        (criteria: unknown, values: Partial<FeishuWikiConnectorEntity>) => {
          const id = Array.isArray(criteria)
            ? (criteria[0] as { id?: string })?.id
            : (criteria as { id?: string }).id;
          const current = [...connectors.values()].find(
            (item) => item.id === id,
          );
          if (
            !current ||
            (Array.isArray(criteria) && current.status === 'syncing') ||
            (!Array.isArray(criteria) && current.status !== 'syncing')
          ) {
            return { affected: 0 };
          }
          Object.assign(current, values, { updatedAt: new Date() });
          return { affected: 1 };
        },
      ),
    } as unknown as Repository<FeishuWikiConnectorEntity>;
    const itemRepo = {
      find: jest.fn(() => [...items.values()]),
      count: jest.fn(
        ({ where }: { where: { connectorId: string; active: boolean } }) =>
          [...items.values()].filter(
            (item) =>
              item.connectorId === where.connectorId &&
              item.active === where.active,
          ).length,
      ),
      create: jest.fn(
        (value: Partial<FeishuWikiItemEntity>) => value as FeishuWikiItemEntity,
      ),
      save: jest.fn((item: FeishuWikiItemEntity) => {
        items.set(item.id, item);
        return item;
      }),
    } as unknown as Repository<FeishuWikiItemEntity>;
    const userRepo = {
      findOne: jest.fn(() => ({
        id: 'admin-1',
        role: 'admin',
        tenantId: 'tenant-1',
      })),
    } as unknown as Repository<UserEntity>;

    let contentText = 'Initial source content';
    let documentVisible = true;
    const feishu = {
      listNodes: jest.fn((_spaceId: string, parentNodeToken?: string) => {
        if (!parentNodeToken) {
          return [
            {
              node_token: 'folder-1',
              obj_type: 'folder',
              title: 'Root',
              has_child: documentVisible,
            },
          ];
        }
        return documentVisible
          ? [
              {
                node_token: 'node-1',
                obj_token: 'doc-1',
                obj_type: 'docx',
                title: 'Handbook',
                has_child: false,
              },
            ]
          : [];
      }),
      getNode: jest.fn(),
      getDocumentContent: jest.fn(() => ({
        text: contentText,
        revisionId: '42',
      })),
    } as unknown as FeishuWikiApiClient;
    const uploads: Array<{
      filename: string;
      content: string;
      userId: string;
    }> = [];
    const lifecycleChanges: Array<{ docId: string; status: string }> = [];
    const documents = {
      upload: jest.fn((filename: string, content: string, userId: string) => {
        uploads.push({ filename, content, userId });
        return { docId: `local-${uploads.length}`, chunkCount: 1 };
      }),
      updateLifecycle: jest.fn(
        (docId: string, _userId: string, status: string) => {
          lifecycleChanges.push({ docId, status });
          return true;
        },
      ),
    } as unknown as DocumentService;
    const accessChanges: Array<{ docId: string; subjects: unknown[] }> = [];
    const setPermissionsMock: jest.Mock = jest.fn(
      (docId: string, subjects: unknown[]) => {
        accessChanges.push({ docId, subjects });
      },
    );
    const permissions = {
      setPermissions: setPermissionsMock,
    };
    const service = new FeishuWikiSyncService(
      connectorRepo,
      itemRepo,
      userRepo,
      feishu,
      documents,
      permissions as unknown as DocumentPermissionService,
    );
    const user = {
      userId: 'admin-1',
      username: 'admin',
      role: 'admin',
      tenantId: 'tenant-1',
    } as JwtPayload;

    await expect(
      service.sync('space-1', { ...user, tenantId: 'tenant-2' }),
    ).rejects.toThrow('RAG tenant is not allowlisted');
    expect((feishu.listNodes as jest.Mock).mock.calls).toHaveLength(0);

    const imported = await service.sync('space-1', user);
    expect(imported).toMatchObject({
      imported: 1,
      updated: 0,
      unchanged: 0,
      discovered: 2,
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.content).toContain('Initial source content');

    let releaseSync: (() => void) | undefined;
    let announceSync: (() => void) | undefined;
    const syncStarted = new Promise<void>((resolve) => {
      announceSync = resolve;
    });
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    (feishu.listNodes as jest.Mock).mockImplementationOnce(async () => {
      announceSync?.();
      await syncGate;
      return [
        {
          node_token: 'node-1',
          obj_token: 'doc-1',
          obj_type: 'docx',
          title: 'Handbook',
          has_child: false,
        },
      ];
    });
    const inFlight = service.sync('space-1', user);
    await syncStarted;
    await expect(service.sync('space-1', user)).rejects.toThrow(
      'Feishu Wiki sync is already running',
    );
    releaseSync?.();
    await inFlight;

    const unchanged = await service.sync('space-1', user);
    expect(unchanged.unchanged).toBe(1);
    expect(uploads).toHaveLength(1);

    (feishu.listNodes as jest.Mock).mockImplementationOnce(() => [
      { node_token: 'node-1' },
    ]);
    await expect(service.sync('space-1', user)).rejects.toThrow(
      'Feishu Wiki node list contains an invalid node',
    );
    expect(items.get([...items.keys()][0])?.active).toBe(true);

    contentText = 'Updated source content';
    (documents.updateLifecycle as jest.Mock).mockResolvedValueOnce(false);
    await expect(service.sync('space-1', user, true)).rejects.toThrow(
      'Previous Feishu Wiki document could not be retired',
    );
    expect(items.get([...items.keys()][0])?.localDocId).toBe('local-1');
    expect(lifecycleChanges).toContainEqual({
      docId: 'local-2',
      status: 'deprecated',
    });

    const updated = await service.sync('space-1', user, true);
    expect(updated.updated).toBe(1);
    expect(updated.shareWithinTenant).toBe(true);
    expect(uploads).toHaveLength(3);
    expect(lifecycleChanges).toContainEqual({
      docId: 'local-1',
      status: 'deprecated',
    });
    expect(accessChanges.at(-1)?.subjects).toEqual([
      { type: 'public', id: 'tenant:tenant-1' },
    ]);

    const listNodesCallsBeforeRevoke = (feishu.listNodes as jest.Mock).mock
      .calls.length;
    setPermissionsMock.mockRejectedValueOnce(
      new Error('ACL store unavailable'),
    );
    await expect(service.sync('space-1', user, false)).rejects.toThrow(
      'Failed to revoke tenant sharing',
    );
    const connectorAfterFailedRevoke = [...connectors.values()][0];
    expect(connectorAfterFailedRevoke).toMatchObject({
      status: 'failed',
      shareWithinTenant: true,
    });
    expect(connectorAfterFailedRevoke?.lastError).toContain(
      'ACL store unavailable',
    );
    expect((feishu.listNodes as jest.Mock).mock.calls).toHaveLength(
      listNodesCallsBeforeRevoke,
    );
    expect(setPermissionsMock).toHaveBeenLastCalledWith('local-3', [
      { type: 'user', id: 'admin-1' },
    ]);

    (feishu.listNodes as jest.Mock).mockRejectedValueOnce(
      new Error('incomplete crawl'),
    );
    await expect(service.sync('space-1', user, false)).rejects.toThrow(
      'incomplete crawl',
    );
    const connectorAfterFailedCrawl = [...connectors.values()][0];
    expect(connectorAfterFailedCrawl).toMatchObject({
      status: 'failed',
      shareWithinTenant: false,
    });
    expect(accessChanges.at(-1)).toEqual({
      docId: 'local-3',
      subjects: [{ type: 'user', id: 'admin-1' }],
    });
    expect(setPermissionsMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      (feishu.listNodes as jest.Mock).mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(items.get([...items.keys()][0])?.active).toBe(true);

    documentVisible = false;
    const removed = await service.sync('space-1', user);
    expect(removed.deactivated).toBe(1);
    expect(items.get([...items.keys()][0])?.active).toBe(false);
    expect(lifecycleChanges).toContainEqual({
      docId: 'local-3',
      status: 'deprecated',
    });
    expect(accessChanges.at(-1)).toEqual({
      docId: 'local-3',
      subjects: [{ type: 'user', id: 'admin-1' }],
    });
    expect(setPermissionsMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      (documents.updateLifecycle as jest.Mock).mock.invocationCallOrder.at(-1) ??
        0,
    );
  });

  it('denies sync and status when the tenant allowlist is missing or blank', async () => {
    const originalAllowlist = process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS;
    const connectorRepo = { findOne: jest.fn() };
    const feishu = { listNodes: jest.fn() };
    const service = new FeishuWikiSyncService(
      connectorRepo as unknown as Repository<FeishuWikiConnectorEntity>,
      {} as Repository<FeishuWikiItemEntity>,
      {} as Repository<UserEntity>,
      feishu as unknown as FeishuWikiApiClient,
      {} as DocumentService,
      {} as DocumentPermissionService,
    );
    const user = { userId: 'admin-1', tenantId: 'tenant-1' } as JwtPayload;

    try {
      for (const allowlist of [undefined, '  , \t']) {
        if (allowlist === undefined) {
          delete process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS;
        } else {
          process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS = allowlist;
        }
        await expect(service.sync('space-1', user)).rejects.toThrow(
          'RAG tenant is not allowlisted',
        );
        await expect(service.status('space-1', user)).rejects.toThrow(
          'RAG tenant is not allowlisted',
        );
      }
    } finally {
      if (originalAllowlist === undefined) {
        delete process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS;
      } else {
        process.env.FEISHU_WIKI_ALLOWED_RAG_TENANT_IDS = originalAllowlist;
      }
    }

    expect(connectorRepo.findOne).not.toHaveBeenCalled();
    expect(feishu.listNodes).not.toHaveBeenCalled();
  });
});
