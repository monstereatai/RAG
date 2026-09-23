import { IamService } from './iam.service';

describe('IamService', () => {
  it('does not return permissions for a suspended tenant', async () => {
    const tenants = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 'tenant-a', status: 'suspended' }),
    };
    const memberships = { findOneBy: jest.fn() };
    const service = new IamService(
      tenants as never,
      memberships as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.hasPermission('user-a', 'platform.read', 'tenant-a'),
    ).resolves.toBe(false);
    expect(memberships.findOneBy).not.toHaveBeenCalled();
  });
});
