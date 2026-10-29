import { DocumentPermissionService } from './document-permission.service';

describe('DocumentPermissionService ACL replacement', () => {
  it('replaces ACL rows inside one transaction and invalidates cache after commit', async () => {
    const manager = {
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const permissionRepo = {
      manager: {
        transaction: jest.fn(async (work: (tx: typeof manager) => unknown) =>
          work(manager),
        ),
      },
    };
    const redisProvider = {
      keys: jest.fn().mockResolvedValue(['doc-acl:user-1::']),
      scan: jest.fn().mockResolvedValue(['doc-acl:user-1::']),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DocumentPermissionService(
      permissionRepo as never,
      {} as never,
      {} as never,
      redisProvider as never,
    );

    await service.setPermissions('doc-1', [{ type: 'user', id: 'user-1' }]);

    expect(permissionRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(manager.delete).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        docId: 'doc-1',
        subjectType: 'user',
        subjectId: 'user-1',
        action: 'read',
      }),
    ]);
    expect(redisProvider.scan).toHaveBeenCalledWith('doc-acl:*');
  });

  it('filters shared ACL results to the current user tenant', async () => {
    const permissionRepo = {
      find: jest.fn().mockResolvedValue([
        { docId: 'doc-same', subjectType: 'public', action: 'read' },
        { docId: 'doc-other', subjectType: 'public', action: 'read' },
        { docId: 'doc-legacy', subjectType: 'public', action: 'read' },
      ]),
    };
    const documentMetaRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { docId: 'doc-same', userId: 'owner-a' },
          { docId: 'doc-other', userId: 'owner-b' },
          { docId: 'doc-legacy', userId: null },
        ]),
    };
    const userRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ role: 'user', tenantId: 'tenant-a' }),
      find: jest.fn().mockResolvedValue([{ id: 'owner-a' }]),
    };
    const redisProvider = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new DocumentPermissionService(
      permissionRepo as never,
      documentMetaRepo as never,
      userRepo as never,
      redisProvider as never,
    );

    await expect(service.getAllowedDocIds('user-a')).resolves.toEqual(
      new Set(['doc-same']),
    );
    expect(redisProvider.set).toHaveBeenCalledWith(
      expect.stringContaining('doc-acl:tenant-a:user-a:'),
      JSON.stringify(['doc-same']),
      300,
    );
  });

  it('uses the authenticated tenant when the database principal is not hydrated', async () => {
    const permissionRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { docId: 'doc-same', subjectType: 'public', action: 'read' },
        ]),
    };
    const documentMetaRepo = {
      find: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ docId: 'doc-same', userId: 'owner-a' }]),
    };
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ role: 'user', tenantId: null }),
      find: jest.fn().mockResolvedValue([{ id: 'owner-a' }]),
    };
    const redisProvider = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new DocumentPermissionService(
      permissionRepo as never,
      documentMetaRepo as never,
      userRepo as never,
      redisProvider as never,
    );

    await expect(
      service.getAllowedDocIds('user-a', [], [], 'tenant-a'),
    ).resolves.toEqual(new Set(['doc-same']));
    expect(redisProvider.set).toHaveBeenCalledWith(
      expect.stringContaining('doc-acl:tenant-a:user-a:'),
      JSON.stringify(['doc-same']),
      300,
    );
  });

  it('rejects a queued write whose tenant does not match the principal', async () => {
    const service = new DocumentPermissionService(
      {} as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue({ tenantId: 'tenant-a' }),
      } as never,
      {} as never,
    );

    await expect(service.assertTenant('user-a', 'tenant-b')).rejects.toThrow(
      'tenant scope does not match current user',
    );
  });
});
