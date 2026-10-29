import { AUDIT_LOG_KEY } from '../../common/decorators/audit-log.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { FeishuWikiController } from './feishu-wiki.controller';

describe('FeishuWikiController', () => {
  const ragClient = {
    syncFeishuWiki: jest.fn(),
    getFeishuWikiStatus: jest.fn(),
  };
  const controller = new FeishuWikiController(ragClient as never);
  const adminRequest = { user: { userId: 'admin-1', role: 'admin' } } as never;

  beforeEach(() => jest.resetAllMocks());

  it('requires a space id and proxies sync results without exposing upstream wrappers', async () => {
    ragClient.syncFeishuWiki.mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          connectorId: 'feishu-wiki:space-1',
          spaceId: 'space-1',
          status: 'completed',
          discovered: 5,
          imported: 2,
          updated: 1,
          unchanged: 1,
          skippedUnsupported: 1,
          deactivated: 0,
        },
      },
    });

    const result = await controller.sync({ spaceId: ' space-1 ' }, adminRequest);

    expect(result).toEqual({
      connectorId: 'feishu-wiki:space-1',
      spaceId: 'space-1',
      status: 'completed',
      discovered: 5,
      imported: 2,
      updated: 1,
      unchanged: 1,
      skippedUnsupported: 1,
      deactivated: 0,
    });
    expect(ragClient.syncFeishuWiki).toHaveBeenCalledWith('admin-1', 'space-1', undefined);
    await expect(controller.sync({ spaceId: '  ' }, adminRequest)).rejects.toThrow('spaceId is required');
  });

  it('passes an explicit tenant-sharing choice through the service-token proxy', async () => {
    ragClient.syncFeishuWiki.mockResolvedValue({ available: true, status: 200, data: { data: { status: 'completed' } } });

    await controller.sync({ spaceId: 'space-1', shareWithinTenant: true }, adminRequest);

    expect(ragClient.syncFeishuWiki).toHaveBeenCalledWith('admin-1', 'space-1', true);
    await expect(
      controller.sync({ spaceId: 'space-1', shareWithinTenant: 'true' as never }, adminRequest),
    ).rejects.toThrow('shareWithinTenant must be a boolean');
  });

  it('rejects non-admin users before proxying sync or status requests', async () => {
    const userRequest = { user: { userId: 'user-1', role: 'user' } } as never;

    await expect(controller.sync({ spaceId: 'space-1' }, userRequest)).rejects.toThrow('admin role is required');
    await expect(controller.status('space-1', userRequest)).rejects.toThrow('admin role is required');
    expect(ragClient.syncFeishuWiki).not.toHaveBeenCalled();
    expect(ragClient.getFeishuWikiStatus).not.toHaveBeenCalled();
  });

  it('preserves the RAG authorization status when tenant sharing is not allowed', async () => {
    ragClient.syncFeishuWiki.mockResolvedValue({
      available: false,
      status: 403,
      data: null,
      error: 'admin tenant context is required',
    });

    await expect(
      controller.sync({ spaceId: 'space-1', shareWithinTenant: true }, adminRequest),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('proxies Feishu status by the supplied space id', async () => {
    const status = {
      connectorId: 'feishu-wiki:space-1',
      spaceId: 'space-1',
      status: 'completed',
      lastSyncAt: '2026-10-15T00:00:00.000Z',
      lastError: null,
      activeItems: 4,
      inactiveItems: 2,
      shareWithinTenant: true,
    };
    ragClient.getFeishuWikiStatus.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: status },
    });

    await expect(controller.status('space-1', adminRequest)).resolves.toEqual(status);
    expect(ragClient.getFeishuWikiStatus).toHaveBeenCalledWith('admin-1', 'space-1');
  });

  it('requires document read/write permissions and audits synchronization', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.status)).toEqual([
      'admin:documents:read',
    ]);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.sync)).toEqual([
      'admin:documents:write',
    ]);
    expect(Reflect.getMetadata(AUDIT_LOG_KEY, controller.sync)).toEqual({
      module: 'integrations',
      action: 'feishu-wiki-sync',
    });
  });
});
